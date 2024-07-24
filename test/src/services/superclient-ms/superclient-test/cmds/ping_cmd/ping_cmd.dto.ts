import { IsString, IsOptional } from 'class-validator';
import { Collection } from '@mikro-orm/core';
export class PingCmdDto {
  @IsString()
  @IsOptional()
  myArg: string;

  //@eicrud:cli:export:delete:next-line
  missingArg: string;

  testNewsArg? = new Collection<any>(this);
}

//used by super-client, update me here
export type PingCmdReturnDto = string;
