/** CLDR plural selection (Intl.PluralRules) – same rule set ICU messages use, so it maps 1:1 onto i18n later. */
const rules = new Intl.PluralRules('da-DK');
export const plural = (n: number, one: string, other: string) => `${n} ${rules.select(n) === 'one' ? one : other}`;
