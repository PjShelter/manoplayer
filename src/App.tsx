import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { CharacterLayer, CharacterModel } from 'webgal_mano';
import { PlayerCanvas } from './PlayerCanvas';
import type { LoadedCharacterModel } from './types';

const POSES_PER_PAGE = 18;

type CopyMode = 'combined' | 'poses' | 'layers';

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

export default function App() {
  const [loaded, setLoaded] = useState<LoadedCharacterModel | null>(null);
  const [activePoses, setActivePoses] = useState<string[]>([]);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [posePage, setPosePage] = useState(0);
  const [copyMode, setCopyMode] = useState<CopyMode>('combined');
  const [copyStatus, setCopyStatus] = useState('');

  const model = useMemo(
    () => (loaded ? withAssetUrls(loaded.model, loaded.serverUrl, loaded.revision) : null),
    [loaded]
  );
  const groupedLayers = useMemo(
    () => groupLayers(loaded?.model.assets.layers ?? []),
    [loaded]
  );
  const poseKeys = useMemo(
    () => (loaded ? Object.keys(loaded.model.controller.poses) : []),
    [loaded]
  );
  const totalPosePages = Math.max(1, Math.ceil(poseKeys.length / POSES_PER_PAGE));
  const pagedPoses = useMemo(
    () => poseKeys.slice(posePage * POSES_PER_PAGE, (posePage + 1) * POSES_PER_PAGE),
    [poseKeys, posePage]
  );
  const layerOverrideEntries = useMemo(
    () => Object.entries(layerVisibility).filter(([, visible]) => visible),
    [layerVisibility]
  );
  const poseParameterText = useMemo(
    () => activePoses.join(', '),
    [activePoses]
  );
  const layerParameterText = useMemo(
    () =>
      layerOverrideEntries
        .map(([layerId, visible]) => `${layerId}${visible ? '+' : '-'}`)
        .join(', '),
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

  async function handleOpenModel() {
    setError('');
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'WebGAL Mano Character Model',
          extensions: ['json']
        }
      ]
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
      setActivePoses([]);
      setLayerVisibility({});
    } finally {
      setLoading(false);
    }
  }

  async function loadCharacterModel(modelPath: string) {
    return invoke<LoadedCharacterModel>('load_character_model', { modelPath });
  }

  function applyLoadedModel(response: LoadedCharacterModel) {
    setLoaded(response);
    setActivePoses(response.model.controller.defaultPoses ?? []);
    setLayerVisibility({});
    setPosePage(0);
    setCopyStatus('');
  }

  function togglePose(pose: string) {
    setActivePoses((current) =>
      current.includes(pose)
        ? current.filter((item) => item !== pose)
        : [...current, pose]
    );
  }

  function toggleLayer(layerId: string) {
    setLayerVisibility((current) => ({
      ...current,
      [layerId]: !(current[layerId] ?? false)
    }));
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

  function resetState() {
    if (!loaded) {
      return;
    }
    setActivePoses(loaded.model.controller.defaultPoses ?? []);
    setLayerVisibility({});
  }

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
      <section className="control-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">DONGSHAN X SHELTER</p>
            <h1>Mano Player</h1>
          </div>
          <button className="primary-button" onClick={handleOpenModel} disabled={loading}>
            {loading ? '加载中...' : '打开角色模型'}
          </button>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        <div className="meta-card">
          <div className="meta-row">
            <span>名称</span>
            <strong>{loaded?.model.metadata.name ?? '未加载'}</strong>
          </div>
          <div className="meta-row">
            <span>默认姿势</span>
            <strong>{loaded?.model.controller.defaultPoses.join(', ') || '-'}</strong>
          </div>
          {/* <div className="meta-row path-row">
            <span>文件</span>
            <strong>{loaded?.modelPath ?? '-'}</strong>
          </div> */}
        </div>

        <div className="section-header">
          <h2>姿势控制</h2>
          <div className="inline-actions">
            <span className="section-hint">
              {loaded ? `${posePage + 1} / ${totalPosePages}` : '- / -'}
            </span>
            <button className="ghost-button" onClick={resetState} disabled={!loaded}>
              重置
            </button>
          </div>
        </div>

        <div className="pager-row">
          <button
            className="ghost-button"
            onClick={() => setPosePage((current) => Math.max(0, current - 1))}
            disabled={!loaded || posePage === 0}
          >
            上一页
          </button>
          <button
            className="ghost-button"
            onClick={() => setPosePage((current) => Math.min(totalPosePages - 1, current + 1))}
            disabled={!loaded || posePage >= totalPosePages - 1}
          >
            下一页
          </button>
        </div>

        <div className="chip-grid">
          {loaded
            ? pagedPoses.map((pose) => (
                <button
                  key={pose}
                  className={activePoses.includes(pose) ? 'chip active' : 'chip'}
                  onClick={() => togglePose(pose)}
                >
                  {pose}
                </button>
              ))
            : <span className="empty-state">加载模型后显示可用姿势</span>}
        </div>

        <div className="section-header">
          <h2>差分图层</h2>
          <span className="section-hint">当前启用 {layerOverrideEntries.length} 项</span>
        </div>

        <div className="layer-groups">
          {loaded
            ? Object.entries(groupedLayers).map(([group, layers]) => (
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
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleLayer(layer.id)}
                          />
                          <span>{layer.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              ))
            : <span className="empty-state">加载模型后显示图层列表</span>}
        </div>

        <div className="section-header">
          <h2>输出参数</h2>
          <span className="section-hint">可直接复制当前状态</span>
        </div>

        <div className="output-card">
          <div className="copy-mode-row">
            <button
              className={copyMode === 'combined' ? 'chip active' : 'chip'}
              onClick={() => setCopyMode('combined')}
            >
              全部
            </button>
            <button
              className={copyMode === 'poses' ? 'chip active' : 'chip'}
              onClick={() => setCopyMode('poses')}
            >
              仅姿势
            </button>
            <button
              className={copyMode === 'layers' ? 'chip active' : 'chip'}
              onClick={() => setCopyMode('layers')}
            >
              仅图层
            </button>
            <button className="primary-button compact-button" onClick={copyOutput}>
              复制
            </button>
          </div>
          <textarea
            className="output-textarea"
            value={outputText}
            readOnly
            placeholder="当前没有可输出的参数"
          />
          <div className="output-footer">
            <span className="section-hint">{copyStatus || '格式：poses / layers'}</span>
          </div>
        </div>
      </section>

      <section className="stage-panel">
        <div className="stage-frame">
          <PlayerCanvas
            model={model}
            activePoses={activePoses}
            layerVisibility={layerVisibility}
          />
        </div>
      </section>
    </main>
  );
}
