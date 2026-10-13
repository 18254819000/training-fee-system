// cookie-parser 本地类型声明（npm registry 的 @types/cookie-parser 拉取失败时的替代）
declare module 'cookie-parser' {
  import { RequestHandler } from 'express';
  function cookieParser(secret?: string | string[], options?: Record<string, unknown>): RequestHandler;
  namespace cookieParser {}
  export default cookieParser;
}
