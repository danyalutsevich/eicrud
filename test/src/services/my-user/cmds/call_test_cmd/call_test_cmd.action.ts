import { ModuleRef } from '@nestjs/core';
import { CallTestCmdDto } from './call_test_cmd.dto';
import { MyUserService } from '../../my-user.service';
import { CrudContext } from '@eicrud/core/crud';

export async function call_test_cmd(
  dto: CallTestCmdDto,
  service: MyUserService,
  ctx: CrudContext,
  inheritance?: any,
) {
  return await service.profileService.$test_cmd(dto, ctx);
}
