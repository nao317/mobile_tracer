import { defineMessages } from "./schema";

export const nativeValidationMessages = defineMessages({
  ja: {
    "nativeValidation.required": "この項目を入力してください。",
    "nativeValidation.selection": "項目を選択してください。",
    "nativeValidation.checked": "この項目を選択してください。",
    "nativeValidation.email": "有効なメールアドレスを入力してください。",
    "nativeValidation.url": "有効なURLを入力してください。",
    "nativeValidation.tooShort": "{min}文字以上で入力してください。",
    "nativeValidation.tooLong": "{max}文字以内で入力してください。",
    "nativeValidation.rangeUnderflow": "{min}以上の値を入力してください。",
    "nativeValidation.rangeOverflow": "{max}以下の値を入力してください。",
    "nativeValidation.number": "有効な数値を入力してください。",
    "nativeValidation.pattern": "指定された形式で入力してください。",
    "nativeValidation.invalid": "入力内容を確認してください。",
  },
  en: {
    "nativeValidation.required": "Please fill out this field.",
    "nativeValidation.selection": "Please select an item.",
    "nativeValidation.checked": "Please select this option.",
    "nativeValidation.email": "Please enter a valid email address.",
    "nativeValidation.url": "Please enter a valid URL.",
    "nativeValidation.tooShort": "Please enter at least {min} characters.",
    "nativeValidation.tooLong": "Please enter no more than {max} characters.",
    "nativeValidation.rangeUnderflow": "Please enter a value of at least {min}.",
    "nativeValidation.rangeOverflow": "Please enter a value no greater than {max}.",
    "nativeValidation.number": "Please enter a valid number.",
    "nativeValidation.pattern": "Please use the requested format.",
    "nativeValidation.invalid": "Please check this field.",
  },
});
