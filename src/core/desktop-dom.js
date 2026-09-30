/** Page-context helpers. Keep each DOM function self-contained for CDP serialization. */
export function findPineEditor(document) {
  const containers = Array.from(document.querySelectorAll('.monaco-editor.pine-editor-monaco'));
  containers.sort((a, b) => Number(b.offsetParent !== null) - Number(a.offsetParent !== null));
  const usable = (editor) => editor && typeof editor.getValue === 'function'
    && typeof editor.setValue === 'function' && typeof editor.getModel === 'function'
    && Boolean(editor.getModel());
  for (const container of containers) {
    let element = container;
    let fiber;
    for (let depth = 0; depth < 20 && element; depth++, element = element.parentElement) {
      const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'));
      if (key) { fiber = element[key]; break; }
    }
    const wrappers = [];
    const environments = [];
    for (let depth = 0; depth < 30 && fiber; depth++, fiber = fiber.return) {
      for (const props of [fiber.memoizedProps, fiber.alternate?.memoizedProps]) {
        const value = props?.value;
        if (value?.monacoEnv) environments.push(value.monacoEnv);
        if (value?._editorRef?.current) wrappers.push(value._editorRef.current);
      }
    }
    for (const wrapper of wrappers) {
      const editor = wrapper._editor || wrapper;
      const env = wrapper._monaco || environments.find((candidate) => candidate.editor);
      try { if (usable(editor) && env?.editor) return { editor, env }; } catch { /* disposed editor */ }
    }
    for (const env of environments) {
      if (typeof env?.editor?.getEditors !== 'function') continue;
      const editors = env.editor.getEditors();
      for (const editor of editors) {
        const node = typeof editor.getDomNode === 'function' ? editor.getDomNode() : null;
        // Do not write into an unrelated editor when a page has several Monaco instances.
        if (node ? !container.contains(node) : editors.length !== 1) continue;
        try { if (usable(editor)) return { editor, env }; } catch { /* disposed editor */ }
      }
    }
  }
  return null;
}

export function requestPineEditor(document, tradingView) {
  const containers = Array.from(document.querySelectorAll('.monaco-editor.pine-editor-monaco'));
  if (containers.some((element) => element.offsetParent !== null)) return 'mounting';
  const buttons = Array.from(document.querySelectorAll('[data-name="pine-dialog-button"], [aria-label="Pine"]'));
  const button = buttons.find((element) => element.offsetParent !== null && !element.disabled);
  if (button) { button.click(); return 'sidebar'; }
  const bar = tradingView?.bottomWidgetBar;
  if (typeof bar?.activateScriptEditorTab === 'function') { bar.activateScriptEditorTab(); return 'bottom-bar'; }
  if (typeof bar?.showWidget === 'function') { bar.showWidget('pine-editor'); return 'bottom-bar'; }
  return null;
}

export function clickPineCompileButton(document) {
  const buttons = Array.from(document.querySelectorAll('button')).filter((button) =>
    button.offsetParent !== null && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  const label = (button) => (button.innerText || button.textContent || '').trim();
  const stable = buttons.find((button) => ['add-script-to-chart', 'update-script-on-chart'].includes(button.getAttribute('data-qa-id')));
  if (stable) { stable.click(); return label(stable) || 'Add or update on chart'; }
  const combined = buttons.find((button) => /save and add to chart/i.test(label(button)));
  const add = buttons.find((button) => /^(add to chart|차트에 넣기)$/i.test(label(button)));
  const update = buttons.find((button) => /^(update on chart|차트에 업데이트)$/i.test(label(button)));
  const selected = combined || add || update;
  if (!selected) return null; // A save-only button must not masquerade as compilation.
  selected.click();
  return label(selected);
}

export function isLandingTarget(target) {
  return target.type === 'page' && (/\/new-tab\/index\.html(?:[?#]|$)/i.test(target.url || '') || target.title === 'New tab');
}

export function clickNewTabButton(document) {
  const button = document.querySelector('button.create-new-tab-button');
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

export function landingTabResult(state, landing) {
  return {
    ...state,
    success: Boolean(landing),
    action: 'new_tab_opened',
    note: landing
      ? 'Tab is on the layout picker. Open a chart layout before using chart commands.'
      : 'The TradingView new-tab landing page did not become ready before the timeout.',
  };
}
