# Explicit Japanese / English i18n

Use the display settings context. It preserves the existing login `useDisplaySettings()` API and the `mt_locale` / `mt_theme` cookies. The root loader owns SSR preference selection.

```tsx
import { useI18n, useTranslation } from "../../components/ui/display-settings";
const t = useTranslation();
t("navigation.home");
t("navigation.paginationSummary", { from: 1, to: 20, total: 1200 });
const { formatDate, formatNumber, formatList, enumLabel, screenTitle, errorMessage } = useI18n();
formatDate(timestamp); // Selected locale; always Asia/Tokyo.
enumLabel("role", "tenant_admin");
screenTitle("record-edit");
errorMessage(result.code, { uncertain: result.uncertain });
```

`TranslationKey` lists every semantic key. `StaticTranslationKey` lists keys without placeholders and is appropriate for navigation descriptors. `Translator` requires the named parameters declared by the Japanese catalog. Numbers interpolate through `Intl.NumberFormat`. No Japanese string keys, DOM rewriting, or implicit translation is supported. React renders interpolated values as ordinary escaped text.

Each feature owner writes an isolated catalog:

```ts
import { defineMessages } from "./schema";
export const featureMessages = defineMessages({
  ja: { "feature.greeting": "こんにちは、{name}さん" },
  en: { "feature.greeting": "Hello, {name}" },
});
```

Register both locale spreads in `index.ts`. `defineMessages` checks exact locale keys and matching placeholder names. Preserve literal types; avoid broad `Record<string,string>` annotations on catalogs. Feature owners own their components and catalogs; the i18n owner maintains registration and shared helpers.

API feedback uses stable codes. `errorMessage` maps backend and preview codes and gives unknown codes a localized generic fallback; `uncertain` results instruct users to check the outcome before retrying. `successMessage` handles save/preview completion. Raw API messages are not translation keys. `fieldError` localizes known codes and otherwise provides a generic field validation message. User-entered names, comments, and other content remain unchanged.

Pure helpers exported by `index.ts` take `language` first, or use `createI18n(language)` outside React. The React hooks memoize these helpers by locale. Dates with invalid or absent values render an em dash. Unknown enum values and screen IDs render a localized unknown label.
