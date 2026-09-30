import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { findPineEditor, requestPineEditor, clickPineCompileButton, isLandingTarget, clickNewTabButton, landingTabResult } from '../src/core/desktop-dom.js';
import { ensurePineEditorOpen } from '../src/core/pine.js';

function button(text, qa, options = {}) {
  return {
    innerText: text, textContent: options.content ?? text, offsetParent: options.hidden ? null : {},
    disabled: options.disabled || false, clicks: 0,
    getAttribute(name) { return name === 'data-qa-id' ? qa : options[name] ?? null; },
    click() { this.clicks++; },
  };
}

function page({ containers = [], buttons = [], sidebar = null, newButton = null, newContainer = null } = {}) {
  return {
    containers,
    querySelectorAll(selector) {
      if (selector === '.monaco-editor.pine-editor-monaco') return this.containers;
      if (selector === 'button') return buttons;
      if (selector.includes('pine-dialog-button')) return sidebar ? [sidebar] : [];
      return [];
    },
    querySelector(selector) {
      if (selector === 'button.create-new-tab-button') return newButton;
      if (selector.includes('[class*="create-new-tab"]')) return newContainer;
      return null;
    },
  };
}

function editorFixture({ alternate = false, depth = 2, legacy = false, disposed = false } = {}) {
  const model = disposed ? null : { uri: 'inmemory://pine/test' };
  const editor = { getValue: () => '//@version=6\nplot(close)', setValue: () => {}, getModel: () => model };
  const env = { editor: { getEditors: () => legacy ? [editor] : [], getModelMarkers: () => [] } };
  const value = legacy ? { monacoEnv: env } : { _editorRef: { current: { _editor: editor, _monaco: env } } };
  let fiber = alternate
    ? { memoizedProps: { value: { _editorRef: { current: null } } }, alternate: { memoizedProps: { value } } }
    : { memoizedProps: { value } };
  for (let i = 0; i < depth; i++) fiber = { memoizedProps: {}, return: fiber };
  const container = { offsetParent: {}, __reactFiber$test: fiber, contains: () => false };
  return { document: page({ containers: [container] }), editor, env };
}

describe('Pine DOM compatibility', () => {
  it('finds the scoped editor when getEditors() is empty', () => {
    const fixture = editorFixture();
    const found = findPineEditor(fixture.document);
    assert.equal(found.editor, fixture.editor);
    assert.equal(found.env, fixture.env);
  });

  it('reads the live alternate fiber instead of a stale mounted context', () => {
    const fixture = editorFixture({ alternate: true, depth: 22 });
    assert.equal(findPineEditor(fixture.document).editor, fixture.editor);
  });

  it('retains the legacy Monaco namespace route', () => {
    const fixture = editorFixture({ legacy: true });
    assert.equal(findPineEditor(fixture.document).editor, fixture.editor);
  });

  it('does not use a disposed editor', () => {
    assert.equal(findPineEditor(editorFixture({ disposed: true }).document), null);
  });

  it('does not choose an unrelated Monaco editor', () => {
    const fixture = editorFixture({ legacy: true });
    fixture.env.editor.getEditors = () => [fixture.editor, { ...fixture.editor }];
    assert.equal(findPineEditor(fixture.document), null);
  });

  it('executes the exact serialized finder used by CDP', () => {
    const fixture = editorFixture({ alternate: true });
    const found = runInNewContext(`(${findPineEditor.toString()})(document)`, { document: fixture.document });
    assert.equal(found.editor, fixture.editor);
  });

  it('opens the sidebar once instead of toggling both entry points', () => {
    const sidebar = button('Pine');
    let bottomCalls = 0;
    const view = { bottomWidgetBar: { activateScriptEditorTab: () => bottomCalls++ } };
    assert.equal(requestPineEditor(page({ sidebar }), view), 'sidebar');
    assert.equal(sidebar.clicks, 1);
    assert.equal(bottomCalls, 0);
  });

  it('opens past a hidden editor placeholder', () => {
    const sidebar = button('Pine');
    const document = page({ sidebar, containers: [{ offsetParent: null }] });
    assert.equal(requestPineEditor(document), 'sidebar');
    assert.equal(sidebar.clicks, 1);
  });

  it('waits for a visible editor to mount without closing it', () => {
    const sidebar = button('Pine');
    assert.equal(requestPineEditor(page({ sidebar, containers: [{ offsetParent: {} }] })), 'mounting');
    assert.equal(sidebar.clicks, 0);
  });

  it('keeps the legacy bottom-bar entry point', () => {
    let called;
    assert.equal(requestPineEditor(page(), { bottomWidgetBar: { showWidget: (name) => { called = name; } } }), 'bottom-bar');
    assert.equal(called, 'pine-editor');
  });

  it('the real opening operation polls a delayed editor without repeated clicks', async () => {
    const sidebar = button('Pine');
    const document = page({ sidebar });
    let sleeps = 0;
    const ready = editorFixture();
    const result = await ensurePineEditorOpen({ _deps: {
      evaluate: (expression) => runInNewContext(expression, { document, window: {} }),
      sleep: async () => { if (++sleeps === 2) document.containers = ready.document.containers; },
    } });
    assert.equal(result, true);
    assert.equal(sidebar.clicks, 1);
    assert.equal(sleeps, 2);
  });

  it('a missing editor stops after a bounded polling window', async () => {
    const sidebar = button('Pine');
    const document = page({ sidebar });
    let sleeps = 0;
    assert.equal(await ensurePineEditorOpen({ _deps: {
      evaluate: (expression) => runInNewContext(expression, { document, window: {} }),
      sleep: async () => { sleeps++; },
    } }), false);
    assert.equal(sleeps, 150);
    assert.equal(sidebar.clicks, 1);
  });
});

describe('Pine compile button selection', () => {
  it('chooses Korean Add despite duplicated hidden text instead of Save', () => {
    const add = button('차트에 넣기', 'add-script-to-chart', { content: '차트에 넣기차트에 넣기' });
    const save = button('저장', 'pine-script-save-button');
    assert.equal(clickPineCompileButton(page({ buttons: [save, add] })), '차트에 넣기');
    assert.equal(add.clicks, 1);
    assert.equal(save.clicks, 0);
  });

  it('uses the stable update hook in another locale', () => {
    const update = button('Actualizar gráfico', 'update-script-on-chart');
    assert.equal(clickPineCompileButton(page({ buttons: [update] })), 'Actualizar gráfico');
    assert.equal(update.clicks, 1);
  });

  it('skips disabled and hidden controls', () => {
    const disabled = button('차트에 넣기', 'add-script-to-chart', { disabled: true });
    const hidden = button('Add to chart', 'add-script-to-chart', { hidden: true });
    assert.equal(clickPineCompileButton(page({ buttons: [disabled, hidden] })), null);
    assert.equal(disabled.clicks + hidden.clicks, 0);
  });

  it('retains English labels when older builds have no hooks', () => {
    const add = button('Add to chart', null, { content: 'Add to chartAdd to chart' });
    assert.equal(clickPineCompileButton(page({ buttons: [add] })), 'Add to chart');
  });

  it('does not treat a save-only control as compilation', () => {
    const save = button('Save', 'pine-script-save-button');
    assert.equal(clickPineCompileButton(page({ buttons: [save] })), null);
    assert.equal(save.clicks, 0);
  });

  it('executes the serialized compile helper without captured imports', () => {
    const add = button('차트에 넣기', 'add-script-to-chart');
    assert.equal(runInNewContext(`(${clickPineCompileButton.toString()})(document)`, { document: page({ buttons: [add] }) }), '차트에 넣기');
    assert.equal(add.clicks, 1);
  });
});

describe('TradingView Desktop new tabs', () => {
  it('recognizes a Korean landing page by its file URL', () => {
    assert.equal(isLandingTarget({ type: 'page', title: '새 탭', url: 'file:///app.asar/app/new-tab/index.html?rendererInitialData=x' }), true);
  });

  it('keeps the legacy English target title', () => {
    assert.equal(isLandingTarget({ type: 'page', title: 'New tab' }), true);
  });

  it('rejects worker targets and lookalike paths', () => {
    assert.equal(isLandingTarget({ type: 'worker', title: '새 탭', url: 'file:///new-tab/index.html' }), false);
    assert.equal(isLandingTarget({ type: 'page', title: 'Other', url: 'file:///new-tab/index.html-other' }), false);
  });

  it('clicks the button instead of its similarly named container', () => {
    const child = button('');
    const parent = button('');
    assert.equal(clickNewTabButton(page({ newButton: child, newContainer: parent })), true);
    assert.equal(child.clicks, 1);
    assert.equal(parent.clicks, 0);
  });

  it('does not overwrite failed readiness with list().success', () => {
    const result = landingTabResult({ success: true, tab_count: 1, tabs: [] }, null);
    assert.equal(result.success, false);
    assert.match(result.note, /timeout/);
  });

  it('reports success when the requested landing page is ready', () => {
    assert.equal(landingTabResult({ success: true }, { id: 'landing' }).success, true);
  });
});
