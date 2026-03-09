import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { CharacterLayer, CharacterModel } from 'webgal_mano';
import { ManoModelEditor } from './ManoModelEditor';
import { PlayerCanvas } from './PlayerCanvas';
import type { LoadedCharacterModel } from './types';

const POSES_PER_PAGE = 18;
const AI_SETTINGS_KEY = 'mano-ai-settings';

type CopyMode = 'combined' | 'poses' | 'layers';
type ViewMode = 'player' | 'editor' | 'settings';

interface AiSettings {
  apiBase: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
}

const DEFAULT_AI_SETTINGS: AiSettings = {
  apiBase: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4.1-mini',
  systemPrompt: 'You generate WebGAL mano controller JSON. Return JSON only with keys baseLayers, defaultPoses, poses.'
};

function withAssetUrls(model: CharacterModel, serverUrl: string, revision: number): CharacterModel {
  return {
    ...model,
    settings: {
      ...model.settings,
      basePath: ''
    },
    assets: {
      ...model.assets,
      layers: model.assets.layers.map((layer) => ({
        ...layer,
        path: `${serverUrl}/${encodeURI(layer.path.replace(/\\/g, '/').replace(/^\.\//, ''))}?v=${revision}`
      }))
    }
  };
}

function groupLayers(layers: CharacterLayer[]) {
  return layers.reduce<Record<string, CharacterLayer[]>>((acc, layer) => {
    acc[layer.group] ??= [];
    acc[layer.group].push(layer);
    return acc;
  }, {});
}

function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_AI_SETTINGS;
    }
    return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) } as AiSettings;
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export default function App() {
  const [loaded, setLoaded] = useState<LoadedCharacterModel | null>(null);
  const [activePoses, setActivePoses] = useState<string[]>([]);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [posePage, setPosePage] = useState(0);
  const [copyMode, setCopyMode] = useState<CopyMode>('combined');
  const [copyStatus, setCopyStatus] = useState('');
  const [editorController, setEditorController] = useState<CharacterModel['controller'] | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('player');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [generatingPsd, setGeneratingPsd] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => loadAiSettings());

  const currentController = editorController ?? loaded?.model.controller ?? null;
  const model = useMemo(() => {
    if (!loaded) {
      return null;
    }

    return withAssetUrls(
      {
        ...loaded.model,
        controller: currentController ?? loaded.model.controller
      },
      loaded.serverUrl,
      loaded.revision
    );
  }, [currentController, loaded]);

  const groupedLayers = useMemo(() => groupLayers(loaded?.model.assets.layers ?? []), [loaded]);
  const poseKeys = useMemo(() => Object.keys(currentController?.poses ?? {}), [currentController]);
  const totalPosePages = Math.max(1, Math.ceil(poseKeys.length / POSES_PER_PAGE));
  const pagedPoses = useMemo(
    () => poseKeys.slice(posePage * POSES_PER_PAGE, (posePage + 1) * POSES_PER_PAGE),
    [poseKeys, posePage]
  );
  const layerOverrideEntries = useMemo(
    () => Object.entries(layerVisibility).filter(([, visible]) => visible),
    [layerVisibility]
  );
  const poseParameterText = useMemo(() => activePoses.join(', '), [activePoses]);
  const layerParameterText = useMemo(
    () => layerOverrideEntries.map(([layerId, visible]) => `${layerId}${visible ? '+' : '-'}`).join(', '),
    [layerOverrideEntries]
  );
  const combinedOutputText = useMemo(() => {
    const lines = [];
    if (poseParameterText) {
      lines.push(`poses=${poseParameterText}`);
    }
    if (layerParameterText) {
      lines.push(`layers=${layerParameterText}`);
    }
    return lines.join('\n');
  }, [layerParameterText, poseParameterText]);
  const outputText = useMemo(() => {
    if (copyMode === 'poses') {
      return poseParameterText;
    }
    if (copyMode === 'layers') {
      return layerParameterText;
    }
    return combinedOutputText;
  }, [combinedOutputText, copyMode, layerParameterText, poseParameterText]);

  async function loadCharacterModel(modelPath: string) {
    return invoke<LoadedCharacterModel>('load_character_model', { modelPath });
  }

  function applyLoadedModel(response: LoadedCharacterModel) {
    setLoaded(response);
    setEditorController(response.model.controller);
    setActivePoses(response.model.controller.defaultPoses ?? []);
    setLayerVisibility({});
    setPosePage(0);
    setCopyStatus('');
  }

  async function handleOpenModel() {
    setError('');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'WebGAL Mano Character Model', extensions: ['json'] }]
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    setLoading(true);
    try {
      const response = await loadCharacterModel(selected);
      applyLoadedModel(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoaded(null);
      setEditorController(null);
      setActivePoses([]);
      setLayerVisibility({});
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateFromPsd() {
    setError('');
    const selectedPsd = await open({
      multiple: false,
      filters: [{ name: 'PSD File', extensions: ['psd'] }]
    });

    if (!selectedPsd || Array.isArray(selectedPsd)) {
      return;
    }

    const selectedOutputDir = await open({
      directory: true,
      multiple: false,
      title: '选择 PSD 导出目录'
    });

    setGeneratingPsd(true);
    try {
      const generatedModelPath = await invoke<string>('generate_mano_from_psd', {
        psdPath: selectedPsd,
        outputDir: typeof selectedOutputDir === 'string' ? selectedOutputDir : null
      });
      const response = await loadCharacterModel(generatedModelPath);
      applyLoadedModel(response);
      setViewMode('editor');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingPsd(false);
    }
  }

  async function handleGenerateAi() {
    if (!loaded || !currentController) {
      return;
    }
    if (!aiSettings.apiKey.trim()) {
      setError('请先在“选项”里填写 AI API Key');
      setViewMode('settings');
      return;
    }

    setGeneratingAi(true);
    setError('');
    try {
      const prompt = [
        'Generate a WebGAL mano controller JSON.',
        'Return strict JSON only.',
        'Keys: baseLayers (string[]), defaultPoses (string[]), poses (Record<string,string[]>).',
        `Character name: ${loaded.model.metadata.name}`,
        `Available layers: ${loaded.model.assets.layers.map((layer) => `${layer.id} [group=${layer.group}, name=${layer.name}]`).join(' | ')}`,
        'Prefer a sensible default pose set and 6-12 useful poses based on arm/face groups.'
      ].join('\n');

      const response = await fetch(aiSettings.apiBase, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aiSettings.apiKey}`
        },
        body: JSON.stringify({
          model: aiSettings.model,
          messages: [
            { role: 'system', content: aiSettings.systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        throw new Error(`AI 请求失败: ${response.status} ${response.statusText}`);
      }

      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('AI 没有返回可解析内容');
      }

      const parsed = JSON.parse(content) as CharacterModel['controller'];
      setEditorController({
        baseLayers: parsed.baseLayers ?? [],
        defaultPoses: parsed.defaultPoses ?? [],
        poses: parsed.poses ?? {}
      });
      setActivePoses(parsed.defaultPoses ?? []);
      setViewMode('editor');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingAi(false);
    }
  }

  function togglePose(pose: string) {
    setActivePoses((current) =>
      current.includes(pose) ? current.filter((item) => item !== pose) : [...current, pose]
    );
  }

  function toggleLayer(layerId: string) {
    setLayerVisibility((current) => ({
      ...current,
      [layerId]: !(current[layerId] ?? false)
    }));
  }

  function resetState() {
    if (!currentController) {
      return;
    }
    setActivePoses(currentController.defaultPoses ?? []);
    setLayerVisibility({});
  }

  function previewDefault() {
    if (!currentController) {
      return;
    }
    setActivePoses(currentController.defaultPoses ?? []);
    setLayerVisibility({});
  }

  function previewPose(poseName: string) {
    if (!currentController) {
      return;
    }
    const base = currentController.defaultPoses.filter((item) => item !== poseName);
    setActivePoses([...base, poseName]);
    setLayerVisibility({});
  }

  async function copyOutput() {
    if (!outputText) {
      setCopyStatus('当前没有可复制的参数');
      return;
    }

    await navigator.clipboard.writeText(outputText);
    setCopyStatus('已复制到剪贴板');
    window.setTimeout(() => setCopyStatus(''), 1500);
  }

  async function exportManoModel() {
    if (!loaded || !currentController) {
      return;
    }

    const targetPath = await save({
      defaultPath: loaded.modelPath,
      filters: [{ name: 'Mano Character Model', extensions: ['json'] }]
    });

    if (!targetPath) {
      return;
    }

    await invoke('save_character_model', {
      modelPath: targetPath,
      modelJson: {
        ...loaded.model,
        controller: currentController
      }
    });
  }

  useEffect(() => {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(aiSettings));
  }, [aiSettings]);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const latestRevision = await invoke<number>('get_character_revision', {
          modelPath: loaded.modelPath
        });

        if (!cancelled && latestRevision > loaded.revision) {
          const refreshed = await loadCharacterModel(loaded.modelPath);
          if (!cancelled) {
            setLoaded(refreshed);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('热更新检查失败:', err);
        }
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loaded]);

  useEffect(() => {
    if (posePage > totalPosePages - 1) {
      setPosePage(Math.max(0, totalPosePages - 1));
    }
  }, [posePage, totalPosePages]);

  return (
    <main className="app-shell">
      <button className="drawer-toggle floating-fab" onClick={() => setDrawerOpen((current) => !current)}>
        {drawerOpen ? '×' : '≡'}
      </button>

      <aside className={drawerOpen ? 'view-drawer open' : 'view-drawer'}>
        <div className="drawer-header">
          <p className="eyebrow">Workspace</p>
          <h2>视图切换</h2>
        </div>
        <button className={viewMode === 'player' ? 'drawer-link active' : 'drawer-link'} onClick={() => { setViewMode('player'); setDrawerOpen(false); }}>
          播放器
        </button>
        <button className={viewMode === 'editor' ? 'drawer-link active' : 'drawer-link'} onClick={() => { setViewMode('editor'); setDrawerOpen(false); }}>
          Mano 编辑器
        </button>
        <button className={viewMode === 'settings' ? 'drawer-link active' : 'drawer-link'} onClick={() => { setViewMode('settings'); setDrawerOpen(false); }}>
          选项
        </button>
        <button className="drawer-link" onClick={() => void handleGenerateFromPsd()} disabled={generatingPsd}>
          {generatingPsd ? 'PSD 生成中...' : '从 PSD 生成'}
        </button>
        <button className="drawer-link" onClick={() => void handleGenerateAi()} disabled={generatingAi || !loaded}>
          {generatingAi ? 'AI 生成中...' : 'AI 一键生成'}
        </button>
        <span className="section-hint">右侧预览始终保留，左侧只显示当前模式的控制区。</span>
      </aside>
      {drawerOpen ? <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} /> : null}

      <section className="control-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">DONGSHAN X SHELTER</p>
            <h1>{viewMode === 'player' ? 'Mano Player' : viewMode === 'editor' ? 'Mano Editor' : 'Options'}</h1>
          </div>
          <div className="inline-actions">
            <button className="ghost-button" onClick={() => setDrawerOpen(true)}>
              切换视图
            </button>
            <button className="primary-button" onClick={handleOpenModel} disabled={loading}>
              {loading ? '加载中...' : '打开角色模型'}
            </button>
          </div>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        <div className="meta-card">
          <div className="meta-row">
            <span>名称</span>
            <strong>{loaded?.model.metadata.name ?? '未加载'}</strong>
          </div>
          <div className="meta-row">
            <span>默认姿势</span>
            <strong>{currentController?.defaultPoses.join(', ') || '-'}</strong>
          </div>
        </div>

        {viewMode === 'player' ? (
          <>
            <div className="section-header">
              <h2>姿势控制</h2>
              <div className="inline-actions">
                <span className="section-hint">{loaded ? `${posePage + 1} / ${totalPosePages}` : '- / -'}</span>
                <button className="ghost-button" onClick={resetState} disabled={!loaded}>
                  重置
                </button>
              </div>
            </div>

            <div className="pager-row">
              <button className="ghost-button" onClick={() => setPosePage((current) => Math.max(0, current - 1))} disabled={!loaded || posePage === 0}>上一页</button>
              <button className="ghost-button" onClick={() => setPosePage((current) => Math.min(totalPosePages - 1, current + 1))} disabled={!loaded || posePage >= totalPosePages - 1}>下一页</button>
            </div>

            <div className="chip-grid">
              {loaded ? pagedPoses.map((pose) => (
                <button key={pose} className={activePoses.includes(pose) ? 'chip active' : 'chip'} onClick={() => togglePose(pose)}>{pose}</button>
              )) : <span className="empty-state">加载模型后显示可用姿势</span>}
            </div>

            <div className="section-header">
              <h2>差分图层</h2>
              <span className="section-hint">当前启用 {layerOverrideEntries.length} 项</span>
            </div>

            <div className="layer-groups">
              {loaded ? Object.entries(groupedLayers).map(([group, layers]) => (
                <details className="layer-group" key={group}>
                  <summary className="layer-group-title">
                    <h3>{group}</h3>
                    <span>{layers.length} 项</span>
                  </summary>
                  <div className="layer-group-body">
                    {layers.map((layer) => {
                      const checked = layerVisibility[layer.id] ?? false;
                      return (
                        <label className="layer-toggle" key={layer.id}>
                          <input type="checkbox" checked={checked} onChange={() => toggleLayer(layer.id)} />
                          <span>{layer.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              )) : <span className="empty-state">加载模型后显示图层列表</span>}
            </div>

            <div className="section-header">
              <h2>输出参数</h2>
              <span className="section-hint">可直接复制当前状态</span>
            </div>

            <div className="output-card">
              <div className="copy-mode-row">
                <button className={copyMode === 'combined' ? 'chip active' : 'chip'} onClick={() => setCopyMode('combined')}>全部</button>
                <button className={copyMode === 'poses' ? 'chip active' : 'chip'} onClick={() => setCopyMode('poses')}>仅姿势</button>
                <button className={copyMode === 'layers' ? 'chip active' : 'chip'} onClick={() => setCopyMode('layers')}>仅图层</button>
                <button className="primary-button compact-button" onClick={copyOutput}>复制</button>
              </div>
              <textarea className="output-textarea" value={outputText} readOnly placeholder="当前没有可输出的参数" />
              <div className="output-footer">
                <span className="section-hint">{copyStatus || '格式：poses / layers'}</span>
              </div>
            </div>
          </>
        ) : viewMode === 'editor' ? (
          <ManoModelEditor
            modelPath={loaded?.modelPath ?? null}
            model={loaded?.model ?? null}
            controller={currentController}
            onChange={setEditorController}
            onExport={exportManoModel}
            onGenerateFromPsd={handleGenerateFromPsd}
            generatingPsd={generatingPsd}
            onPreviewDefault={previewDefault}
            onPreviewPose={previewPose}
            onGenerateAi={handleGenerateAi}
            generatingAi={generatingAi}
          />
        ) : (
          <section className="editor-card">
            <div className="section-header">
              <h2>AI 选项</h2>
              <span className="section-hint">保存到本地浏览器存储</span>
            </div>
            <label className="settings-field">
              <span>API Base</span>
              <input className="settings-input" value={aiSettings.apiBase} onChange={(event) => setAiSettings((current) => ({ ...current, apiBase: event.target.value }))} />
            </label>
            <label className="settings-field">
              <span>API Key</span>
              <input className="settings-input" type="password" value={aiSettings.apiKey} onChange={(event) => setAiSettings((current) => ({ ...current, apiKey: event.target.value }))} />
            </label>
            <label className="settings-field">
              <span>Model</span>
              <input className="settings-input" value={aiSettings.model} onChange={(event) => setAiSettings((current) => ({ ...current, model: event.target.value }))} />
            </label>
            <label className="settings-field">
              <span>System Prompt</span>
              <textarea className="editor-textarea" value={aiSettings.systemPrompt} onChange={(event) => setAiSettings((current) => ({ ...current, systemPrompt: event.target.value }))} />
            </label>
            <div className="inline-actions wrap-actions">
              <button className="ghost-button" onClick={() => setAiSettings(DEFAULT_AI_SETTINGS)}>恢复默认</button>
              <button className="primary-button" onClick={() => void handleGenerateAi()} disabled={generatingAi || !loaded}>测试 AI 生成</button>
            </div>
          </section>
        )}
      </section>

      <section className="stage-panel">
        <div className="stage-frame">
          <PlayerCanvas model={model} activePoses={activePoses} layerVisibility={layerVisibility} />
        </div>
      </section>
    </main>
  );
}
