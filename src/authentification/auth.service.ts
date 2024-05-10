import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException, forwardRef } from '@nestjs/common';
import { CrudUserService } from '../user/crud-user.service';
import { JwtService } from '@nestjs/jwt';
import { _utils } from '../utils';

import * as bcrypt from 'bcrypt';
import { t } from '@mikro-orm/core';
import { CRUD_CONFIG_KEY, CrudConfigService } from '../crud/crud.config.service';
import { CrudErrors } from '../crud/model/CrudErrors';
import { CrudUser } from '../user/model/CrudUser';
import { ModuleRef } from '@nestjs/core';
import { LoginResponseDto } from '../crud/model/dtos';
import { CrudContext } from '../crud/model/CrudContext';


export interface AuthenticationOptions {
  SALT_ROUNDS;
  SALT_ROUNDS_ADMIN;
  USERNAME_FIELD: string;
  JWT_FIELD_IN_PAYLOAD: string[];
  JWT_SECRET: string;
  VERIFICATION_EMAIL_TIMEOUT_HOURS: number;
  TWOFA_EMAIL_TIMEOUT_MIN: number;
  PASSWORD_RESET_EMAIL_TIMEOUT_HOURS: number;
  PASSWORD_MAX_LENGTH: number;
}

@Injectable()
export class CrudAuthService {

  protected JWT_SECRET: string;
  protected FIELDS_IN_PAYLOAD: string[] = ['revokedCount'];
  protected USERNAME_FIELD = 'email';
  protected crudConfig: CrudConfigService;

  constructor(
    protected jwtService: JwtService,
    protected moduleRef: ModuleRef,
  ) {

  }

  onModuleInit() {
    this.crudConfig = this.moduleRef.get(CRUD_CONFIG_KEY,{ strict: false })
    this.JWT_SECRET = this.crudConfig.authenticationOptions.JWT_SECRET;
    this.FIELDS_IN_PAYLOAD = this.crudConfig.authenticationOptions.JWT_FIELD_IN_PAYLOAD;
    this.FIELDS_IN_PAYLOAD.push(this.crudConfig.id_field);
    this.USERNAME_FIELD = this.crudConfig.authenticationOptions.USERNAME_FIELD;
  }

  rateLimitCount = 6;

  async updateUser(user: CrudUser, patch: Partial<CrudUser>, ctx: CrudContext){
    const res = this.crudConfig.userService.unsecure_fastPatchOne(user[this.crudConfig.id_field], patch as any, ctx);
    return res;
  }

  async signIn(ctx: CrudContext, email, pass, expiresIn = '30m', twoFA_code?): Promise<LoginResponseDto> {
    email = email.toLowerCase().trim();
    const entity = {};
    entity[this.USERNAME_FIELD] = email;
    const user: CrudUser = await this.crudConfig.userService.findOne(entity, null);
    if(!user){
      throw new UnauthorizedException(CrudErrors.INVALID_CREDENTIALS.str());
    }

    if(user?.timeout && user.timeout > new Date()){
      throw new UnauthorizedException(CrudErrors.TIMED_OUT.str(user.timeout.toISOString()));
    }

    if(user.failedLoginCount >= this.rateLimitCount){
      const timeoutMS = Math.min(user.failedLoginCount*user.failedLoginCount*1000, 60000 * 5);
      const diffMs = _utils.diffBetweenDatesMs(new Date(), user.lastLoginAttempt);
      if(diffMs < timeoutMS){ 
          throw new HttpException({
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: 'Too Many Requests',
            message: CrudErrors.TOO_MANY_LOGIN_ATTEMPTS.str(Math.round((timeoutMS-diffMs)/1000) + " seconds"),
        }, 429);
      }
    }

    if(user.twoFA && this.crudConfig.emailService){
      if(!twoFA_code){
        await this.crudConfig.userService.sendTwoFACode(user[this.crudConfig.id_field], user as CrudUser, null);
        throw new UnauthorizedException(CrudErrors.TWOFA_REQUIRED.str());
      }
      await this.crudConfig.userService.verifyTwoFA(user, twoFA_code);
    }
    
    user.lastLoginAttempt = new Date();

    const match = await bcrypt.compare(pass, user?.password);
    if (!match) {
      const addPatch: Partial<CrudUser> =  { lastLoginAttempt: user.lastLoginAttempt};
      const query = { [this.crudConfig.id_field]: user[this.crudConfig.id_field] };
      const increments = {failedLoginCount: 1}
      this.crudConfig.userService.unsecure_incPatch({ query, increments, addPatch }, ctx);

      throw new UnauthorizedException(CrudErrors.INVALID_CREDENTIALS.str());
    }

    let updatePass = null;
    if(user.saltRounds != this.crudConfig.getSaltRounds(user)){
      console.log("Updating password hash for user: ", user[this.crudConfig.id_field]);
      updatePass = pass;
    }

    user.failedLoginCount = 0;
    const patch = { failedLoginCount: 0, lastLoginAttempt: user.lastLoginAttempt} as Partial<CrudUser>;
    if(updatePass){
      patch.password = updatePass;
    }
    await this.updateUser(user, patch, ctx);
    const payload = {};
    this.FIELDS_IN_PAYLOAD.forEach(field => {
        payload[field] = user[field];
    });
    return {
      accessToken: await this.signTokenForUser(user, expiresIn),
      userId: user[this.crudConfig.id_field],
    } as LoginResponseDto;
  }

  signTokenForUser(user,  expiresIn = '30m'){
    const payload = {};
    this.FIELDS_IN_PAYLOAD.forEach(field => {
        payload[field] = user[field];
    });
    return this.jwtService.sign(payload,
        {
        secret: this.JWT_SECRET,
        expiresIn
        });
  }


  async getJwtPayload(token: string) {
    return await this.jwtService.verifyAsync(
      token,
      {
        secret: this.JWT_SECRET,
      }
    );
  }
}