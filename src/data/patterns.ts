/**
 * 常用正则表达式及对应的脱敏模板。预置词库与「正则速查」中的模板共用这些定义，
 * 并在 regexReference.test.ts / replace.test.ts 中逐一验证。
 * 分组只为脱敏服务，不影响匹配范围。
 */

/** 中国大陆 11 位手机号，前后不能紧挨其他数字 */
export const PHONE = '(?<!\\d)(1[3-9]\\d)\\d{4}(\\d{4})(?!\\d)';
/** 138****8000 */
export const PHONE_MASK = '$1****$2';

/** 18 位居民身份证号（校验出生年月日范围） */
export const ID_CARD =
  '(?<!\\d)([1-9]\\d{5})(?:18|19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])(\\d{3}[\\dXx])(?!\\d)';
/** 110105********002X */
export const ID_CARD_MASK = '$1********$2';

export const EMAIL = '([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})';
/** z***@example.com */
export const EMAIL_MASK = '$1***$2';

/** 16～19 位银行卡号，允许每 4 位用空格或短横线分隔；分组为最后 4 位 */
export const BANK_CARD = '(?<!\\d)(?:62\\d{2}|4\\d{3}|5[1-5]\\d{2})(?:[ -]?\\d{4}){2}[ -]?\\d{0,3}(\\d{4})(?!\\d)';
/** **** **** **** 7890 */
export const BANK_CARD_MASK = '**** **** **** $1';

const OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
/** IPv4 地址；分组为前两段 */
export const IPV4 = `(?<![\\d.])(${OCTET}\\.${OCTET})\\.${OCTET}\\.${OCTET}(?!\\.?\\d)`;
/** 192.168.*.* */
export const IPV4_MASK = '$1.*.*';
