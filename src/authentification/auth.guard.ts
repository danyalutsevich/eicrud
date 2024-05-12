import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';

import { CrudContext } from '../crud/model/CrudContext';

import { CrudUser } from '../user/model/CrudUser';

import { Cron, CronExpression } from '@nestjs/schedule';
import { CRUD_CONFIG_KEY, CrudConfigService } from '../crud/crud.config.service';
import { LogType } from '../log/entities/log';
import { CrudErrors } from '../crud/model/CrudErrors';
import { CrudOptions } from '../crud/model/CrudOptions';
import { CrudRole } from '../crud/model/CrudRole';
import { CrudAuthService } from './auth.service';
import { ModuleRef } from '@nestjs/core';
import { LRUCache } from 'mnemonist';

export class TrafficWatchOptions{
  MAX_TRACKED_USERS: number = 10000;

  MAX_TRACKED_IPS: number = 10000;

  USER_REQUEST_THRESHOLD: number = 350;
  
  IP_REQUEST_THRESHOLD: number = 700;

  TIMEOUT_THRESHOLD_TOTAL: number = 5;

  TIMEOUT_DURATION_MIN: number = 15;

  useForwardedIp: boolean = false;
  ddosProtection: boolean = false;
  userTrafficProtection: boolean = true;
}

export interface ValidationOptions{
  DEFAULT_MAX_SIZE: number;
  DEFAULT_MAX_LENGTH: number;
  DEFAULT_MAX_ITEMS_PER_USER: number;
}


@Injectable()
export class CrudAuthGuard implements CanActivate {
  
  userTrafficMap: LRUCache<string, number>;
  ipTrafficMap: LRUCache<string, number>;
  timedOutIps: LRUCache<string, number>;

  reciprocalRequestThreshold: number;
  
  protected crudConfig: CrudConfigService;

  
  @Cron(CronExpression.EVERY_5_MINUTES)
  handleCron() {
    this.userTrafficMap.clear();
    this.ipTrafficMap.clear();
  }

  
  constructor(
    protected moduleRef: ModuleRef,
    protected authService: CrudAuthService
    ) {
      authService.authGuard = this;
    }

    onModuleInit() {
      this.crudConfig = this.moduleRef.get(CRUD_CONFIG_KEY,{ strict: false })
      this.userTrafficMap = new LRUCache(this.crudConfig.watchTrafficOptions.MAX_TRACKED_USERS);
      this.ipTrafficMap = new LRUCache(this.crudConfig.watchTrafficOptions.MAX_TRACKED_IPS);
      this.timedOutIps = new LRUCache(this.crudConfig.watchTrafficOptions.MAX_TRACKED_IPS);

      this.reciprocalRequestThreshold = 1 / this.crudConfig.watchTrafficOptions.USER_REQUEST_THRESHOLD;
    }

  async canActivate(context: ExecutionContext): Promise<boolean> {

    if(this.crudConfig.isIsolated){
      throw new BadRequestException('This instance is isolated.')
    }

    const request = context.switchToHttp().getRequest();
    
    const ip = this.crudConfig.watchTrafficOptions.useForwardedIp ? request.headers['x-forwarded-for'] : request.socket.remoteAddress;
    const crudContext: CrudContext = { ip };

    if(this.crudConfig.watchTrafficOptions.ddosProtection){
      let timeout = this.timedOutIps.get(ip);
      if(timeout != undefined){
        if(timeout > Date.now()){
          await this.addTrafficToIpTrafficMap(ip, true);
          throw new HttpException({
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            message: `Your IP (${ip}) is timed out.`,
          }, 429);
        }
      }
      await this.addTrafficToIpTrafficMap(ip);
    }

    const token = this.extractTokenFromHeader(request);
    let user: Partial<CrudUser> = { role: this.crudConfig.guest_role};
    let userId;
    const options: CrudOptions = request.query?.query?.options || {};
    if (token) {
      try {
        const payload = await this.authService.getJwtPayload(token);
        crudContext.jwtPayload = payload;
        const query = {
          [this.crudConfig.id_field] : payload[this.crudConfig.id_field]
        }
        if(request.method == 'POST' ){
          user = await this.crudConfig.userService.findOne(query, null) as any;
        }else{
          user = await this.crudConfig.userService.findOneCached(query, null);
        }

        if(!user){
          throw new UnauthorizedException(CrudErrors.USER_NOT_FOUND.str());
        }

        if(user?.timeout && user.timeout > new Date()){
          throw new UnauthorizedException(CrudErrors.TIMED_OUT.str(user.timeout.toISOString()));
        }

        const role: CrudRole = this.crudConfig?.rolesMap[user?.role];

        if(user?.revokedCount != payload.revokedCount){
          throw new UnauthorizedException(CrudErrors.TOKEN_MISMATCH.str());
        }

        if(user?.captchaRequested && !user?.didCaptcha 
          && !request.url.includes('crud/captcha')
          && this.crudConfig.captchaService
          ){
          throw new UnauthorizedException(CrudErrors.CAPTCHA_REQUIRED.str());
        }  

        userId = user?.[this.crudConfig.id_field];

        if(options.mockRole && typeof options.mockRole == 'string' && role){
          const parents = this.crudConfig.getParentRolesRecurs(role).map(role => role.name);
          parents.push(role.name);
          if(!parents.includes(options.mockRole)){
            throw new UnauthorizedException(`Role ${role.name} is not allowed to mock as ${options.mockRole}`);
          }
          user.role = options.mockRole;
        }

        if(this.crudConfig.watchTrafficOptions.userTrafficProtection){
          await this.addTrafficToUserTrafficMap(userId, user, ip);
        }

      } catch(e) {
        throw new UnauthorizedException(e);
      }
    }

    user.crudUserDataMap = user.crudUserDataMap || {};
    crudContext.user = user as any;
    crudContext.userId = userId;
    if(!token){
      crudContext.userTrust = 0;
    }
    request['crudContext'] = crudContext
    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  

  async addTrafficToIpTrafficMap(ip: string, silent = false){
    let traffic = this.ipTrafficMap.get(ip);
    if (traffic === undefined) {
      traffic = 0;
    }
    if(traffic > this.crudConfig.watchTrafficOptions.IP_REQUEST_THRESHOLD){
      if(!silent){
        this.crudConfig.logService?.log(LogType.SECURITY, 
          `High traffic event for ip with ${traffic} requests.`, 
          { ip } as CrudContext
          )
      }
      const timeout_end = Date.now() + this.crudConfig.watchTrafficOptions.TIMEOUT_DURATION_MIN * 60 * 1000;
      this.timedOutIps.set(ip, timeout_end);
      return true;
    }
    this.ipTrafficMap.set(ip, traffic + 1);
    return false;
  }

  async addTrafficToUserTrafficMap(userId, user: Partial<CrudUser>, ip){
    let traffic = this.userTrafficMap.get(userId);
    if (traffic === undefined) {
      traffic = 0;
    }
    const multiplier = user.allowedTrafficMultiplier || 1;
    if(traffic >= (this.crudConfig.watchTrafficOptions.USER_REQUEST_THRESHOLD * multiplier)){
      user.highTrafficCount = user.highTrafficCount || 0;
      let count;
      if(multiplier > 1){
        count = traffic / (this.crudConfig.watchTrafficOptions.USER_REQUEST_THRESHOLD*multiplier);
      }else{
        count = traffic * this.reciprocalRequestThreshold;
      }          
      user.highTrafficCount += Math.round(count);

      if(user.highTrafficCount >= this.crudConfig.watchTrafficOptions.TIMEOUT_THRESHOLD_TOTAL){
        this.crudConfig.userService.addTimeoutToUser(user as CrudUser, this.crudConfig.watchTrafficOptions.TIMEOUT_DURATION_MIN)
      }
      user.captchaRequested = true;
      this.crudConfig.userService.unsecure_fastPatchOne(userId, { highTrafficCount: user.highTrafficCount }, null);
      this.crudConfig.userService.setCached(user, null);
      this.crudConfig.logService?.log(LogType.SECURITY, 
        `High traffic event for user ${userId} with ${traffic} requests.`, 
        { userId, user, ip } as CrudContext
        )
      await this.crudConfig.onHighTrafficEvent(traffic, user);
      traffic = 0;
    }
    this.userTrafficMap.set(userId, traffic + 1);
  }

}