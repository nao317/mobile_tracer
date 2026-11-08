import { coreMessages } from "./core";
import { entryMessages } from "./entry";
import { errorMessages } from "./errors";
import { managementMessages } from "./management";
import { previewManagementMessages } from "./preview-management";
import { workflowMessages } from "./workflow";
import type { Placeholders } from "./schema";

export { defineMessages } from "./schema";
export type Language = "ja" | "en";
export type Theme = "light" | "dark";

export const messages = {
  ja: {
    ...coreMessages.ja,
    ...entryMessages.ja,
    ...errorMessages.ja,
    ...managementMessages.ja,
    ...previewManagementMessages.ja,
    ...workflowMessages.ja,
  },
  en: {
    ...coreMessages.en,
    ...entryMessages.en,
    ...errorMessages.en,
    ...managementMessages.en,
    ...previewManagementMessages.en,
    ...workflowMessages.en,
  },
} as const;

type Message<K extends TranslationKey> = (typeof messages.ja)[K];
export type TranslationKey = keyof typeof messages.ja;
export type StaticTranslationKey = {
  [K in TranslationKey]: [Placeholders<Message<K>>] extends [never] ? K : never;
}[TranslationKey];
export type TranslationParams<K extends TranslationKey> = Record<
  Placeholders<Message<K>>,
  string | number
>;
export type Translator = <K extends TranslationKey>(
  key: K,
  ...args: [Placeholders<Message<K>>] extends [never]
    ? []
    : [params: TranslationParams<K>]
) => string;

export function createTranslator(language: Language): Translator {
  return ((key: TranslationKey, params?: Record<string, string | number>) => {
    if (!Object.hasOwn(messages[language], key)) {
      throw new Error(`Unknown translation key: ${key}`);
    }
    const template: string = messages[language][key];
    return template.replace(/\{([^{}]+)\}/g, (_, name: string) => {
      if (!params || !Object.hasOwn(params, name)) {
        throw new Error(`Missing interpolation value: ${name}`);
      }
      const value = params[name];
      return typeof value === "number" ? formatNumber(language, value) : value;
    });
  }) as Translator;
}

export const localeFor = (language: Language) =>
  language === "ja" ? "ja-JP" : "en-US";

export function formatDate(
  language: Language,
  value?: string | number | Date | null,
  options?: Intl.DateTimeFormatOptions,
) {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(localeFor(language), {
    ...(options ?? { dateStyle: "medium", timeStyle: "short" }),
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export function formatNumber(
  language: Language,
  value: number,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(localeFor(language), options).format(value);
}

export function formatList(
  language: Language,
  values: Iterable<string>,
  options?: Intl.ListFormatOptions,
) {
  return new Intl.ListFormat(localeFor(language), options).format(values);
}

export function successMessage(language: Language, code?: string | null) {
  return createTranslator(language)(
    code === "preview_saved"
      ? "common.previewSaved"
      : code === "saved"
        ? "common.saved"
        : "common.completed",
  );
}

type EnumKey = Extract<TranslationKey, `enum.${string}`>;
export type EnumGroup = EnumKey extends `enum.${infer G}.${string}` ? G : never;

/** Only stable enum codes are accepted; unknown values use a localized label. */
export function enumLabel(
  language: Language,
  group: EnumGroup,
  value: string | null | undefined,
): string {
  const key = `enum.${group}.${value}`;
  return Object.hasOwn(messages[language], key)
    ? (messages[language] as Record<string, string>)[key]
    : createTranslator(language)("common.unknown");
}

export function screenTitle(language: Language, screen: string): string {
  const key = `screen.${screen}`;
  return Object.hasOwn(messages[language], key)
    ? (messages[language] as Record<string, string>)[key]
    : createTranslator(language)("common.unknown");
}

const errorKeys = {
  result_unknown: "error.uncertain",
  request_failed: "error.generic",
  configuration_unavailable: "error.configurationMismatch",
  validation: "error.validation",
  validation_error: "error.validation",
  invalid_input: "error.validation",
  forbidden: "error.forbidden",
  unauthorized: "error.unauthorized",
  not_found: "error.notFound",
  conflict: "error.conflict",
  version_conflict: "error.versionConflict",
  timeout: "error.uncertain",
  outcome_uncertain: "error.uncertain",
  network_error: "error.network",
  unavailable: "error.unavailable",
  configuration_mismatch: "error.configurationMismatch",
} as const satisfies Record<string, StaticTranslationKey>;

export function errorMessage(
  language: Language,
  code?: string | null,
  options: { uncertain?: boolean } = {},
): string {
  const detailedKey = `errorCode.${code}`;
  if (code && Object.hasOwn(errorMessages[language], detailedKey)) {
    return (errorMessages[language] as Record<string, string>)[detailedKey];
  }
  const key = code && Object.hasOwn(errorKeys, code)
    ? errorKeys[code as keyof typeof errorKeys]
    : options.uncertain
      ? "error.uncertain"
      : "error.generic";
  return createTranslator(language)(key);
}

const fieldKeys = {
  legal_name: "management.legalCompanyName",
  description: "management.companyDescription",
  website: "management.website",
  phone: "management.phone",
  address: "management.address",
  contact_email: "management.contactEmail",
  business_types: "management.businessType",
  account_type: "management.accountType",
  status: "management.status",
  version: "management.applicationVersion",
  decision: "management.reviewStatus",
} as const satisfies Record<string, StaticTranslationKey>;

export function fieldLabel(language: Language, field: string): string {
  const normalized = field.replace(/^entries\.|^entry:|^profile\./, "");
  if (Object.hasOwn(fieldKeys, normalized)) {
    return createTranslator(language)(fieldKeys[normalized as keyof typeof fieldKeys]);
  }
  const key = `field.${normalized}`;
  return Object.hasOwn(messages[language], key)
    ? (messages[language] as Record<string, string>)[key]
    : normalized;
}

export function fieldError(language: Language, message?: string): string {
  if (message && Object.hasOwn(errorKeys, message)) {
    return errorMessage(language, message);
  }
  return createTranslator(language)("error.fieldInvalid");
}

export function createI18n(language: Language) {
  return {
    language,
    t: createTranslator(language),
    formatDate: (
      value?: string | number | Date | null,
      options?: Intl.DateTimeFormatOptions,
    ) => formatDate(language, value, options),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      formatNumber(language, value, options),
    formatList: (values: Iterable<string>, options?: Intl.ListFormatOptions) =>
      formatList(language, values, options),
    enumLabel: (group: EnumGroup, value: string | null | undefined) =>
      enumLabel(language, group, value),
    screenTitle: (screen: string) => screenTitle(language, screen),
    errorMessage: (code?: string | null, options?: { uncertain?: boolean }) =>
      errorMessage(language, code, options),
    successMessage: (code?: string | null) => successMessage(language, code),
    fieldLabel: (field: string) => fieldLabel(language, field),
    fieldError: (message?: string) => fieldError(language, message),
  };
}
