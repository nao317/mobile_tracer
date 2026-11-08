/** Named placeholders are part of the translation's public API. */
export type Placeholders<S extends string> =
  S extends `${string}{${infer P}}${infer Rest}`
    ? P | Placeholders<Rest>
    : never;

type SamePlaceholders<A extends string, B extends string> =
  [Placeholders<A>] extends [Placeholders<B>]
    ? [Placeholders<B>] extends [Placeholders<A>]
      ? B
      : never
    : never;

export function defineMessages<
  const JA extends Record<string, string>,
  const EN extends Record<keyof JA, string>,
>(messages: {
  ja: JA;
  en: EN &
    Record<Exclude<keyof EN, keyof JA>, never> & {
      [K in keyof JA]: SamePlaceholders<JA[K], EN[K]>;
    };
}) {
  return messages;
}
