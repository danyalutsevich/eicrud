import { set } from "mnemonist";
import { CrudOptions } from "../shared/CrudOptions";
import { CrudQuery } from "../shared/CrudQuery";
import { Cookies } from "js-cookie"
import { FindResponseDto } from "../shared/FindResponseDto";
import axios from "axios";
import { CrudErrors } from "../shared/CrudErrors";

export interface ClientStorage {

  get(name: string): string;
  set(name: string, value: string, duration: string, secure: boolean): void;
  del(name: string): void;

}

export class CookieStorage implements ClientStorage {
  get(name: string): string {
    return Cookies.get(name);
  }
  set(name: string, value: string, durationDays: string, secure: boolean): void {
    return Cookies.set(name, value, { expires: durationDays, secure: secure });
  }
  del(name: string): void {
    return Cookies.remove(name);
  }
}

export class MemoryStorage implements ClientStorage {

  memory = new Map<string, any>();

  get(name: string): string {
    return this.memory.get(name);
  }
  set(name: string, value: string, duration: string, secure: boolean): void {
    this.memory.set(name, value);
  }
  del(name: string): void {
    this.memory.delete(name);
  }
}

export class CrudClient<T> {

  JWT_COOKIE_KEY = "crud-client";

  serviceName: string;
  url: string;
  storage: ClientStorage;

  id_field: string;

  constructor(args: { serviceName: string, url: string, storage?: ClientStorage, id_field?: string }) {
    this.serviceName = args.serviceName;
    this.url = args.url;
    this.id_field = args.id_field || "id";
    this.storage = args.storage || document ? new CookieStorage() : new MemoryStorage();
  }

  private _getHeaders() {
    const headers: any = {};
    const jwt = this.storage.get(this.JWT_COOKIE_KEY);
    if (jwt) {
      headers.Authorization = `Bearer ${jwt}`
    }
    return headers;
  }

  disconnect() {
    this.storage.del(this.JWT_COOKIE_KEY);
  }

  private async _tryOrDisconnect(method, optsIndex, ...args) {
    let res;
    try {
      res = await method(...args);
    } catch (e) {
      if (e.response && e.response.status === 401) {
        this.disconnect();
      } else {
        throw e;
      }
      args[optsIndex] = {
        ...args[optsIndex],
        headers: this._getHeaders()
      };
      res = await method(...args);
    }
    return res;
  }

  async findOne(query: any, options: CrudOptions = undefined): Promise<T> {
    const crudQuery: CrudQuery = {
      service: this.serviceName,
      options: options,
      query: JSON.stringify(query)
    }
    const url = this.url + "/crud/one";

    const res = await this._tryOrDisconnect(axios.get, 1, url, { params: crudQuery, headers: this._getHeaders() });

    return res;
  }

  private async _doLimitQuery(fetchFunc: (q: CrudQuery) => Promise<FindResponseDto<any>>, crudQuery: CrudQuery) {
    const options = crudQuery.options;
    const res: FindResponseDto<any> = await fetchFunc(crudQuery);

    if (res.limit > 0 && (!options.limit || res.limit < options.limit) && res.total > res.limit) {
      let offset = res.limit;
      let total = options.limit || res.total;
      while (offset < total) {
        const newOptions: CrudOptions = { ...options, limit: res.limit, offset: res.limit };
        const newCrudQuery: CrudQuery = {
          ...crudQuery,
          options: newOptions,
        }
        const newRes: FindResponseDto<any> = await fetchFunc(newCrudQuery);
        res.data.push(...newRes.data);
        offset += res.limit;
      }
      res.limit = total;
    }

    return res;
  }

  async find(query: any, options: CrudOptions = undefined): Promise<FindResponseDto<T>> {
    const crudQuery: CrudQuery = {
      service: this.serviceName,
      options: options,
      query: JSON.stringify(query)
    }
    const url = this.url + "/crud/many";

    async function fetchFunc(crdQuery: CrudQuery) {
      return await this._tryOrDisconnect(axios.get, 1, url, { params: crdQuery, headers: this._getHeaders() });
    }

    return await this._doLimitQuery(fetchFunc, crudQuery);

  }

  async findIn(ids: any[], options: CrudOptions = undefined): Promise<FindResponseDto<T>> {
    const crudQuery: CrudQuery = {
      service: this.serviceName,
      options: options,
      query: JSON.stringify({ [this.id_field]: ids })
    }
    const url = this.url + "/crud/in";

    async function fetchFunc(crdQ: CrudQuery) {
      return await this._tryOrDisconnect(axios.get, 1, url, { params: crdQ, headers: this._getHeaders() });
    }

    return await this._doLimitQuery(fetchFunc, crudQuery);
  }

  async findIds(query: any, options: CrudOptions = undefined): Promise<FindResponseDto<string>> {
    const crudQuery: CrudQuery = {
      service: this.serviceName,
      options: options,
      query: JSON.stringify(query)
    }
    const url = this.url + "/crud/ids";

    async function fetchFunc(crdQ: CrudQuery) {
      return await this._tryOrDisconnect(axios.get, 1, url, { params: crdQ, headers: this._getHeaders() });
    }

    return await this._doLimitQuery(fetchFunc, crudQuery);
  }

  private async _doCmd(cmdName: string, dto: any, options: CrudOptions, secure: boolean, limited: boolean): Promise<any> {
    const crudQuery: CrudQuery = {
      service: this.serviceName,
      options: options,
      cmd: cmdName
    }
    const url = this.url + "/crud/cmd";

    const method = secure ? axios.post : axios.get;

    if (limited) {

      async function fetchFunc(crdQuery: CrudQuery) {
        return await this._tryOrDisconnect(method, 2, url, dto, { params: crdQuery, headers: this._getHeaders() });
      }

      return await this._doLimitQuery(fetchFunc, crudQuery);

    }

    const res = await this._tryOrDisconnect(secure ? axios.post : axios.patch, 2, url, dto, { params: crudQuery, headers: this._getHeaders() });

    return res;
  }

  async patchOne(q: object | string[], data: any, options: CrudOptions = undefined): Promise<T> {
    let query = {};
    if (Array.isArray(q)) {
      const limitingFields = q;
      if (!limitingFields.includes(this.id_field)) {
        limitingFields.push(this.id_field)
      }
      limitingFields.forEach(f => {
        if (data[f] !== undefined) {
          query[f] = data[f]
          delete data[f];
        }
      });
    } else {
      query = q;
    }

    const crudQuery: CrudQuery = {
      service: this.serviceName,
      options: options,
      query: JSON.stringify(query)
    }

    const url = this.url + "/crud/one";

    const res = await this._tryOrDisconnect(axios.patch, 2, url, data, { params: crudQuery, headers: this._getHeaders() });

    return res;

  }

  async patchMany(query: object, data: any, options: CrudOptions = undefined): Promise<FindResponseDto<T>> {
    const crudQuery: CrudQuery = {
      service: this.serviceName,
      options: options,
      query: JSON.stringify(query)
    }
    const url = this.url + "/crud/many";

    const res = await this._tryOrDisconnect(axios.patch, 2, url, data, { params: crudQuery, headers: this._getHeaders() });

    return res;
  }

  async patchIn(ids: any[], data: any, options: CrudOptions = undefined): Promise<FindResponseDto<T>> {
    const crudQuery: CrudQuery = {
      service: this.serviceName,
      options: options,
      query: JSON.stringify({ [this.id_field]: ids })
    }
    const url = this.url + "/crud/in";

    const res = await this._tryOrDisconnect(axios.patch, 2, url, data, { params: crudQuery, headers: this._getHeaders() });

    return res;
  }

  async patchBatch(limitingFields: string[], objects: any[], batchSize = 0, options: CrudOptions = undefined): Promise<T[]> {
    if (!limitingFields.includes(this.id_field)) {
      limitingFields.push(this.id_field)
    }
    const datas = objects.map(o => {
      const query = {};
      limitingFields.forEach(f => {
        if (o[f] !== undefined) {
          query[f] = o[f]
          delete o[f];
        }
      });
      return { query, data: o };
    });

    return await this._patchBatch(datas, batchSize, options);

  }

  private _splitArrayIntoChunks(arr: any[], chunkSize: number): any[] {
    const chunks = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
      chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async _patchBatch(datas: { query: any, data: any }[], batchSize = 0, options: CrudOptions = undefined): Promise<T[]> {
    const url = this.url + "/crud/batch";

    const crudQuery: CrudQuery = {
      service: this.serviceName,
      options: options,
    }

    function batchFunc(chunk){
      this._tryOrDisconnect(axios.patch, 2, url, chunk, { params: crudQuery, headers: this._getHeaders() })
    }

    return await this._doBatch(batchFunc, datas, batchSize);
  }


  private async _doBatch(batchFunc: (datas) => any, datas, batchSize = 0){
    let res;

    let chunks = [datas];
    if (batchSize > 0) {
      chunks = this._splitArrayIntoChunks(datas, batchSize);
    }

    try {
      const res = [];
      for (const chunk of chunks) {
        const r = await batchFunc(chunk);
        res.push(...r);
      }
    } catch (e) {
      if (e.response && e.response.status === 401) {
        const parsedMessage = JSON.parse(e.response.data);
        if (parsedMessage.code == CrudErrors.MAX_BATCH_SIZE_EXCEEDED.code) {
          const maxBatchSize = parsedMessage.data.maxBatchSize;
          if (maxBatchSize < batchSize) {
            return await this._doBatch(batchFunc, datas, maxBatchSize);
          }
        }
      }
      throw e;
    }

    return res;
  }

  async postBatch(objects: any[], batchSize = 0, options: CrudOptions = undefined): Promise<T[]> {
    const url = this.url + "/crud/batch";

    const crudQuery: CrudQuery = {
      service: this.serviceName,
      options: options,
    }

    function batchFunc(chunk){
      this._tryOrDisconnect(axios.post, 2, url, chunk, { params: crudQuery, headers: this._getHeaders() })
    }

    return await this._doBatch(batchFunc, objects, batchSize);  
  }

  async postOne(data: any, options: CrudOptions = undefined): Promise<T> {
    const crudQuery: CrudQuery = {
      service: this.serviceName,
      options: options,
    }
    const url = this.url + "/crud/one";

    const res = await this._tryOrDisconnect(axios.post, 2, url, data, { params: crudQuery, headers: this._getHeaders() });

    return res;
  }

  async cmd(cmdName: string, dto: any, options: CrudOptions = undefined): Promise<any> {
    return await this._doCmd(cmdName, dto, options, false, false);
  }

  async cmdL(cmdName: string, dto: any, options: CrudOptions = undefined): Promise<any> {
    return await this._doCmd(cmdName, dto, options, false, true);
  }

  async cmdS(cmdName: string, dto: any, options: CrudOptions = undefined): Promise<any> {
    return await this._doCmd(cmdName, dto, options, true, false);
  }

  async cmdSL(cmdName: string, dto: any, options: CrudOptions = undefined): Promise<any> {
    return await this._doCmd(cmdName, dto, options, true, true);
  }


}
