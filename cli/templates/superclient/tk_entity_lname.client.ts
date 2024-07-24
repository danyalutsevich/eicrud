import { SuperClientConfig, ClientOptions, CrudClient } from "@eicrud/client";
import { ICrudOptions } from "@eicrud/shared/interfaces";
import { tk_entity_name } from "./tk_entity_lname.entity";


export class tk_entity_nameClient extends CrudClient<tk_entity_name> {
  constructor(config: SuperClientConfig) {
    super({...config, serviceName: 'tk_entity_lname'});
  }
  // GENERATED START
}