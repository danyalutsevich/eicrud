import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Embedded,
} from '@mikro-orm/core';
import { IsString, IsOptional, IsInt, ValidateNested } from 'class-validator';
import { CrudEntity } from '@eicrud/core/crud';
import { MyUser } from '../my-user/my-user.entity';
import { SharedEmbeddable } from '../superclient-ms/shared-dto';
import { $Type } from '@eicrud/core/validation';
@Entity()
export class DragonFruit implements CrudEntity {
  @PrimaryKey({ name: '_id' })
  @IsString()
  @IsOptional()
  id: string;

  @ManyToOne(() => MyUser)
  @IsString()
  owner: MyUser | string;

  //@eicrud:cli:export:delete:start
  @Property()
  @IsString()
  ownerEmail: string;

  @Property()
  @IsInt()
  @IsOptional()
  size: number = 1;
  //@eicrud:cli:export:delete:end

  @Property()
  @IsString()
  name: string;

  @Property()
  @IsString()
  secretCode: string;

  @Property()
  createdAt: Date;

  @Property()
  updatedAt: Date;

  @Embedded(() => SharedEmbeddable, { nullable: true })
  @$Type(SharedEmbeddable)
  @IsOptional()
  @ValidateNested()
  testEmbedded: SharedEmbeddable;
}
