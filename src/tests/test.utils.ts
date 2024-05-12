import { EntityManager, ObjectId } from "@mikro-orm/mongodb";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { UserProfile } from "./entities/UserProfile";
import { Melon } from "./entities/Melon";
import { CrudConfigService } from "../crud/crud.config.service";
import { CrudUserService } from "../user/crud-user.service";
import { CrudUser } from "../user/model/CrudUser";


export interface TestUser{
  email: string,
  role: string,
  bio: string,
  id?: string,
  profileId?: string,
  profileType?: string,
  jwt?: string,
  skipProfile?:boolean
  store?: any,
  melons?: number,
  favoriteColor?: string
  password?: string
}

export function createId(crudConfig: CrudConfigService){
  let id;
  switch(crudConfig.dbType){
    case 'mongo':
      id = new ObjectId();
    break;
    default:
      id = Math.random().toString(36).substring(7);
  }
  return formatId(id, crudConfig);
}

export function formatId(id: any, crudConfig: CrudConfigService){
  switch(crudConfig.dbType){
    case 'mongo':
      return id?.toString();
    default:
      return id;
  }
}


export function testMethod(arg: { app: NestFastifyApplication, 
    method: string,
    url: string,
    jwt?: string, 
    entityManager: EntityManager, 
    payload: any, 
    query: any,
    expectedCode: number,
    fetchEntity?: { entity: any, id: string },
    fetchEntities?: { entity: any, query: any },
    expectedObject?: any,
    crudConfig: CrudConfigService,
    returnLimitAndTotal?: boolean
    }){
    const headers = {};
    if(arg.jwt){
        headers['Authorization'] = `Bearer ${arg.jwt}`;
    }
    return arg.app
      .inject({
        method: arg.method as any,
        url: arg.url,
        headers,
        payload: arg.payload,
        query: new URLSearchParams(arg.query as any).toString()
      })
      .then(async (result) => {
        let total;
        let limit;
        if(result.statusCode !== arg.expectedCode){
            console.error(result.json());
        }
        expect(result.statusCode).toEqual(arg.expectedCode);
        let res: any = result.payload != '' ? result.json() : {};
        if(arg.method === 'GET' && (arg.url.includes('many') || arg.url.includes('in') || arg.url.includes('ids'))){
          ({ total, limit } = res);
          res = res.data;
        }
        if(arg.fetchEntity){
            let id = arg.fetchEntity.id || res.id;
            id = arg.crudConfig.userService.checkId(id);
            res = await arg.entityManager.fork().findOne(arg.fetchEntity.entity, { id });
            res = JSON.parse(JSON.stringify(res));
        }else if(arg.fetchEntities){
            res = await arg.entityManager.fork().find(arg.fetchEntities.entity, arg.fetchEntities.query);
            res = JSON.parse(JSON.stringify(res));
        }

        if(arg.expectedObject){
          const arr = Array.isArray(res) ? res : [res];
          for(const re of arr){
            for(const key in arg.expectedObject){
                expect(JSON.stringify(re[key])).toEqual(JSON.stringify(arg.expectedObject[key]));
            }
          }
        }
        if(arg.returnLimitAndTotal){
          return { data: res, total, limit };
        }
        return res;
      });
}

export async function createNewProfileTest(app, jwt, entityManager, payload, query, crudConfig: CrudConfigService, expectedCode = 201){ 
  const res = await  testMethod({ url: '/crud/one', method: 'POST', expectedCode, app, jwt: jwt, entityManager, payload, query, crudConfig});
  if(expectedCode !== 201){
    return;
  }
  let resDb = await entityManager.fork().findOne(UserProfile, { id: res[crudConfig.id_field] }) as UserProfile;
  resDb = JSON.parse(JSON.stringify(res));
  expect(res.address).toBeUndefined();
  expect((resDb as any).address).toBeUndefined();
  expect(res.userName).toEqual(payload.userName);
  expect(resDb.userName).toEqual(payload.userName);
  return res;
}

export function createMelons(NB_MELONS, owner: TestUser, crudConfig: CrudConfigService){
  const payloadArray = [];
  for(let i = 0; i < NB_MELONS; i++){
    const newMelon: Partial<Melon> = {
      name: `Melon ${i}`,
      owner: owner[crudConfig.id_field],
      price: i,
      ownerEmail: owner.email,
    }
    payloadArray.push(newMelon);
  }
  return payloadArray;
}


export async function createAccountsAndProfiles(users: Record<string, TestUser>, em: EntityManager, userService: CrudUserService<CrudUser>, crudConfig: CrudConfigService, config : { usersWithoutProfiles?: string[], testAdminCreds: { email?: string, password: string } }){
  const promises = [];
  for(const key in users){
    const user = users[key];
    const prom = userService.$createAccount(user.email, user.password || config.testAdminCreds.password, null, user.role ).then(
      async (accRes) => {
        users[key][crudConfig.id_field] = accRes.userId;
        users[key].jwt = accRes.accessToken;
        if(!user.skipProfile){
          const newObj = {
            id: userService.createNewId() as any,
            userName: key,
            user: users[key][crudConfig.id_field],
            bio: user.bio,
            createdAt: new Date(),
            updatedAt: new Date()
          }
          if(user.profileType){
            newObj['type'] = user.profileType;
          }
          if(user.favoriteColor){
            newObj['favoriteColor'] = user.favoriteColor;
          }
          const newProfile = em.create(UserProfile, newObj);
          if(user.store) { user.store[key] = newProfile; }
          em.persist(newProfile);
          users[key].profileId = newProfile[crudConfig.id_field];
        }else{
          config.usersWithoutProfiles?.push(users[key][crudConfig.id_field]);
        }
        if(user.melons){
          const melons = createMelons(user.melons, user, crudConfig);
          for(const melon of melons){
            melon.id = userService.createNewId() as any;
            melon.createdAt = new Date();
            melon.updatedAt = new Date();
            const newMelon = em.create(Melon, melon)
            em.persist(newMelon);
          }
        }
        await em.flush();
      }
    );
    promises.push(prom);
  }
  await Promise.all(promises);
}