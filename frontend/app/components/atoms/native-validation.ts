import { nativeValidationMessages } from "../../i18n/native-validation";

type NativeControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const ownedMessages = new WeakMap<NativeControl, string>();

// Only clear messages set by this helper; application validation keeps precedence.
export function clearNativeValidation(control: NativeControl) {
  const message = ownedMessages.get(control);
  if (message && control.validationMessage === message) control.setCustomValidity("");
  ownedMessages.delete(control);
}

export function localizeNativeValidation(control: NativeControl) {
  clearNativeValidation(control);
  const validity = control.validity;
  if (validity.valid || validity.customError) return;

  const lang = control.closest("[lang]")?.getAttribute("lang") ?? "ja";
  const language = lang.toLowerCase().startsWith("en") ? "en" : "ja";
  const messages = nativeValidationMessages[language];
  const type = control.getAttribute("type");
  let message: string = messages["nativeValidation.invalid"];
  if (validity.valueMissing) {
    message = control.tagName === "SELECT"
      ? messages["nativeValidation.selection"]
      : type === "checkbox" || type === "radio"
        ? messages["nativeValidation.checked"]
        : messages["nativeValidation.required"];
  } else if (validity.typeMismatch) {
    message = type === "email"
      ? messages["nativeValidation.email"]
      : type === "url"
        ? messages["nativeValidation.url"]
        : messages["nativeValidation.invalid"];
  } else if (validity.tooShort) {
    message = messages["nativeValidation.tooShort"].replace("{min}", control.getAttribute("minlength") ?? "");
  } else if (validity.tooLong) {
    message = messages["nativeValidation.tooLong"].replace("{max}", control.getAttribute("maxlength") ?? "");
  } else if (validity.rangeUnderflow) {
    message = messages["nativeValidation.rangeUnderflow"].replace("{min}", control.getAttribute("min") ?? "");
  } else if (validity.rangeOverflow) {
    message = messages["nativeValidation.rangeOverflow"].replace("{max}", control.getAttribute("max") ?? "");
  } else if (validity.badInput || validity.stepMismatch) {
    message = messages["nativeValidation.number"];
  } else if (validity.patternMismatch) {
    message = messages["nativeValidation.pattern"];
  }
  control.setCustomValidity(message);
  ownedMessages.set(control, message);
}
