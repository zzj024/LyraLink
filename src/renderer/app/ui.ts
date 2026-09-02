import { computed } from "vue";
import { createDiscreteApi, darkTheme } from "naive-ui";
import { activeAccent, naiveOverridesFor, themeMode } from "./theme.js";

const configProviderProps = computed(() => ({
  theme: themeMode.value === "dark" ? darkTheme : null,
  themeOverrides: naiveOverridesFor(themeMode.value, activeAccentValue())
}));

function activeAccentValue(): string {
  return activeAccent.value;
}

/** 供 store / 非组件环境使用的全局消息与确认框（与 App 内 Provider 同主题） */
export const { message, dialog } = createDiscreteApi(["message", "dialog"], {
  configProviderProps
});

export type ToastKind = "success" | "error" | "warning" | "info";

export function toast(text: string, kind: ToastKind = "info"): void {
  message.create(text, { type: kind, duration: 3200, keepAliveOnHover: true });
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const { title, message: content, confirmText = "确认", danger = false } = options;
    dialog[danger ? "warning" : "info"]({
      title,
      content,
      positiveText: confirmText,
      negativeText: "取消",
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onMaskClick: () => resolve(false),
      onClose: () => resolve(false)
    });
  });
}
