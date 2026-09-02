<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { THEME_PRESETS, applyAppearance, isLightColor } from "../theme.js";
import { useModalsStore } from "../stores/modals.js";
import { useSettingsStore } from "../stores/settings.js";

const modals = useModalsStore();
const settings = useSettingsStore();

const name = ref("");
const accent = ref("#e7ff57");
const surface = ref("#121311");
const error = ref("");

const isPreset = computed(() => modals.themeEditor.kind === "preset");
const presetDef = computed(() => THEME_PRESETS.find((p) => p.id === modals.themeEditor.id));
const customTheme = computed(() =>
  (settings.settings.customThemes || []).find((t) => t.id === modals.themeEditor.id)
);
const override = computed(() => settings.settings.themeOverrides?.[modals.themeEditor.id]);

const title = computed(() => {
  if (isPreset.value) return `编辑预设主题 · ${presetDef.value?.name || ""}`;
  return `编辑主题 · ${customTheme.value?.name || ""}`;
});
const hasOverride = computed(() => Boolean(settings.settings.themeOverrides?.[modals.themeEditor.id]));

watch(
  () => modals.themeEditor.open,
  (open) => {
    if (!open) return;
    error.value = "";
    if (modals.themeEditor.kind === "preset") {
      const def = presetDef.value;
      if (!def) return;
      name.value = def.name;
      accent.value = override.value?.accent ?? def.accent;
      surface.value = override.value?.surface ?? def.surface;
    } else {
      const theme = customTheme.value;
      if (!theme) return;
      name.value = theme.name;
      accent.value = theme.accent;
      surface.value = theme.surface;
    }
  }
);

// 实时预览：编辑中的颜色立即应用到整个界面（含图标），取消时自动还原
function previewLive() {
  const id = modals.themeEditor.id;
  if (isPreset.value) {
    applyAppearance({
      ...settings.settings,
      theme: id,
      themeOverrides: {
        ...(settings.settings.themeOverrides || {}),
        [id]: { accent: accent.value, surface: surface.value }
      }
    });
  } else {
    applyAppearance({
      ...settings.settings,
      theme: id,
      customThemes: (settings.settings.customThemes || []).map((t) =>
        t.id === id
          ? { ...t, accent: accent.value, surface: surface.value, mode: isLightColor(surface.value) ? "light" as const : "dark" as const }
          : t
      )
    });
  }
}
watch([accent, surface], previewLive);

function save() {
  if (!accent.value || !surface.value) {
    error.value = "请选择颜色。";
    return;
  }
  if (isPreset.value) {
    settings.savePresetOverride(modals.themeEditor.id, { accent: accent.value, surface: surface.value });
  } else {
    const trimmed = name.value.trim();
    if (!trimmed) {
      error.value = "主题名称不能为空。";
      return;
    }
    // 名称需要唯一，否则主题列表里会出现无法区分的同名主题
    const duplicate = (settings.settings.customThemes || []).some(
      (theme) => theme.id !== modals.themeEditor.id && theme.name === trimmed
    ) || THEME_PRESETS.some((preset) => preset.name === trimmed);
    if (duplicate) {
      error.value = `已存在名为“${trimmed}”的主题，请换一个名字。`;
      return;
    }
    settings.updateCustomTheme(modals.themeEditor.id, {
      name: trimmed,
      mode: isLightColor(surface.value) ? "light" : "dark",
      accent: accent.value,
      surface: surface.value
    });
  }
  modals.closeThemeEditor();
}

function resetPreset() {
  settings.resetPresetOverride(modals.themeEditor.id);
  const def = presetDef.value;
  if (def) {
    accent.value = def.accent;
    surface.value = def.surface;
  }
  error.value = "";
}

/** 取消/关闭时恢复已保存的主题 */
function restoreSaved() {
  settings.applyTheme();
}
const onClose = () => {
  restoreSaved();
  modals.closeThemeEditor();
};
</script>

<template>
  <n-modal
    :show="modals.themeEditor.open"
    preset="card"
    style="width: 420px"
    :title="title"
    :bordered="false"
    @mask-click="onClose"
    @after-leave="onClose"
    @close="onClose"
  >
    <div class="editor">
      <div class="preview">
        <div class="pv-window" :style="{ background: surface }">
          <div class="pv-side">
            <span class="pv-logo" :style="{ background: accent, color: isLightColor(accent) ? '#17180f' : '#ffffff' }">L</span>
            <span class="pv-nav"></span><span class="pv-nav on"></span><span class="pv-nav"></span>
          </div>
          <div class="pv-main">
            <span class="pv-line" :style="{ background: accent }"></span>
            <span class="pv-line"></span>
            <span class="pv-line short"></span>
          </div>
        </div>
      </div>

      <div class="field">
        <label>主题名称</label>
        <input v-if="!isPreset" v-model="name" class="inp" maxlength="20" />
        <input v-else class="inp" :value="presetDef?.name" disabled />
      </div>

      <div class="field">
        <label>强调色</label>
        <input v-model="accent" type="color" class="color" />
      </div>
      <div class="field">
        <label>底色</label>
        <input v-model="surface" type="color" class="color" />
      </div>

      <p v-if="error" class="err">{{ error }}</p>
    </div>

    <template #footer>
      <div class="acts" style="justify-content: space-between">
        <button v-if="isPreset && hasOverride" class="btn ghost sm" @click="resetPreset">↺ 恢复默认</button>
        <span v-else></span>
        <div style="display: flex; gap: 9px">
          <button class="btn secondary" @click="onClose">取消</button>
          <button class="btn primary" @click="save">保存</button>
        </div>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.preview { display: flex; justify-content: center; margin-bottom: 18px; }
.pv-window {
  width: 240px; height: 120px; border-radius: 12px; display: grid; grid-template-columns: 56px 1fr;
  overflow: hidden; border: 1px solid var(--line-strong);
  background: v-bind(surface);
}
.pv-side { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0; background: rgba(0, 0, 0, 0.18); }
.pv-logo {
  width: 24px; height: 24px; border-radius: 8px; display: grid; place-items: center;
  font-weight: 800; font-size: 12px;
}
.pv-nav { width: 34px; height: 7px; border-radius: 4px; background: rgba(128, 128, 128, 0.35); }
.pv-nav.on { background: rgba(128, 128, 128, 0.6); }
.pv-main { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
.pv-line { height: 9px; border-radius: 5px; background: rgba(128, 128, 128, 0.3); }
.pv-line.short { width: 55%; }
.field { display: flex; align-items: center; gap: 12px; margin-bottom: 13px; }
.field label { width: 64px; flex: none; font-size: 12.5px; color: var(--ink-2); }
.inp {
  flex: 1; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--line-strong);
  background: var(--bg); color: var(--ink); font-size: 13px; outline: none;
}
.inp:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.inp:disabled { opacity: 0.6; }
.color { width: 56px; height: 32px; padding: 2px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg); cursor: pointer; }
</style>
