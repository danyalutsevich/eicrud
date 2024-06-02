Commands are user-defined functions attached to a service. They're useful when you need to perform complex non-crud operations.

## Generate a new command

You can use the [CLI](){:target="_blank"} to quickly generate a new command.

```
eicrud generate cmd profile sayHello
```
!!! note
    Command names are converted to `snake_case` by the CLI


Like [services](/services/definition), CMDs have 3 main components:

### A Dto:

```typescript title="services/profile/cmds/say_hello/say_hello.dto.ts"
export default class SayHelloDto {

    @IsString()
    @IsOptional()
    arg: string;

}
```

Command DTOs follow the same [validation](/services/validation)/[transform](/services/transform) rules as [entities](/services/entity).

### A [Security](/../security/definition):

```typescript title="services/profile/cmds/say_hello/say_hello.security.ts"
const getCmdSecurity = (say_hello, profile): CmdSecurity => { 
    return {
        dto: SayHelloDto,
        rolesRights: {
            user: {
                async defineCMDAbility(can, cannot, ctx) {
                    // Define abilities for user

                }
            }
        },
    }
}
```
This is where you define the access rules for your CMD. As for the service security, nothing is allowed unless specified.

Ability syntax is `can(<cmd_name>, <service_name>, ...args)`, for example:
```typescript
async defineCMDAbility(can, cannot, ctx) {
    can(say_hello, profile) //User can call say_hello on service profile
}
```

### An Action:
```typescript title="services/profile/cmds/sayhello/sayhello.action.ts"
export default function say_hello(dto, service, ctx, inheritance?){
    return `Hello ${dto.arg}!`
}
```
This is the CMD implementation. Any value returned is sent back to the client.

Eicrud's controller will route CMD calls to your CrudService's methods (`'$' + <cmd_name>`):
```typescript title="services/profile/profile.service.ts"
async $say_hello(dto: SayHelloDto, ctx: CrudContext, inheritance?: any) {
   return await serviceCmds.say_hello.action(dto, this, ctx, inheritance);
}
```
## Call your command

You can call your command from the [client]():
```typescript 
const dto = { arg: 'world'};
const res = await profileClient.cmd('say_hello', dto);
console.log(res) // Hello world!
```

Or you can call your CMD from another [service](definition.md#import-your-service):
```typescript 
const dto = { arg: 'world'};
const res = await profileService.$say_hello(dto, null);
console.log(res) // Hello world!
```

!!! info
    `$` functions should always be treated as async, check out [this guide](../microservices/dollar-functions.md) to learn more.