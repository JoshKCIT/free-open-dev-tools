import meta from './meta.json';

export { meta };
export { DbHashError } from './errors';
export { saslprep, type SaslprepResult } from './saslprep';
export {
  scramSha256,
  parseScram,
  scramKeys,
  SCRAM_ITERATIONS,
  type ScramOptions,
  type ScramResult,
  type ParsedScram,
} from './scram';
export {
  postgresMd5,
  mysqlNativePassword,
  quotePgIdentifier,
  quoteMysqlString,
  alterRolePostgres,
  alterUserMysql,
  alterUserMariadb,
  identifierLengthWarning,
} from './legacy';
export {
  detectKind,
  verifyStoredHash,
  constantTimeEqual,
  MATCH_MESSAGE,
  NO_MATCH_MESSAGE,
  type StoredHashKind,
  type VerifyOptions,
  type VerifyResult,
} from './verify';
