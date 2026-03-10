import { useEffect, useMemo, useState } from 'react';
import type { CharacterLayer, CharacterModel } from 'webgal_mano';

type ControllerState = CharacterModel['controller'];

interface ManoModelEditorProps {
  modelPath: string | null;
  model: CharacterModel | null;
  controller: ControllerState | null;
  onChange: (next: ControllerState) => void;
  onExport: () => Promise<void>;
  onGenerateFromPsd: () => Promise<void>;
  generatingPsd: boolean;
  onPreviewDefault: () => void;
  onPreviewPose: (poseName: string) => void;
  onGenerateAi: () => Promise<void>;
  generatingAi: boolean;
}

function toLineArray(input: string) {
  return input
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildCommandLibrary(layers: CharacterLayer[]) {
  const groups = new Map<string, string[]>();

  for (const layer of layers) {
    if (!groups.has(layer.group)) {
      groups.set(layer.group, [`${layer.group}-`]);
    }
    groups.get(layer.group)!.push(`${layer.group}>${layer.name}`);
    groups.get(layer.group)!.push(`${layer.group}+${layer.name}`);
    groups.get(layer.group)!.push(`${layer.group}-${layer.name}`);
  }

  return Array.from(groups.entries()).map(([group, commands]) => ({
    group,
    commands: Array.from(new Set(commands))
  }));
}

export function ManoModelEditor({
  modelPath,
  model,
  controller,
  onChange,
  onExport,
  onGenerateFromPsd,
  generatingPsd,
  onPreviewDefault,
  onPreviewPose,
  onGenerateAi,
  generatingAi
}: ManoModelEditorProps) {
  const [selectedPose, setSelectedPose] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  const poseNames = useMemo(() => Object.keys(controller?.poses ?? {}), [controller]);
  const commandLibrary = useMemo(() => buildCommandLibrary(model?.assets.layers ?? []), [model]);
  const baseLayersText = useMemo(() => (controller?.baseLayers ?? []).join('\n'), [controller]);
  const selectedPoseCommands = useMemo(
    () => (selectedPose && controller?.poses[selectedPose] ? controller.poses[selectedPose] : []),
    [controller, selectedPose]
  );
  const selectedPoseText = useMemo(() => selectedPoseCommands.join('\n'), [selectedPoseCommands]);
  const exportPreview = useMemo(() => JSON.stringify(model ? { ...model, controller } : {}, null, 2), [controller, model]);

  useEffect(() => {
    if (!selectedPose || !controller?.poses[selectedPose]) {
      setSelectedPose(poseNames[0] ?? '');
    }
  }, [controller, poseNames, selectedPose]);

  function updateBaseLayers(value: string) {
    if (!controller) {
      return;
    }
    onChange({
      ...controller,
      baseLayers: toLineArray(value)
    });
  }

  function removeBaseLayer(command: string) {
    if (!controller) {
      return;
    }
    onChange({
      ...controller,
      baseLayers: controller.baseLayers.filter((item) => item !== command)
    });
  }

  function toggleDefaultPose(poseName: string) {
    if (!controller) {
      return;
    }
    const current = new Set(controller.defaultPoses);
    if (current.has(poseName)) {
      current.delete(poseName);
    } else {
      current.add(poseName);
    }
    onChange({
      ...controller,
      defaultPoses: Array.from(current)
    });
  }

  function addPose() {
    if (!controller) {
      return;
    }
    let index = poseNames.length + 1;
    let candidate = `Pose${index}`;
    while (controller.poses[candidate]) {
      index += 1;
      candidate = `Pose${index}`;
    }
    onChange({
      ...controller,
      poses: {
        ...controller.poses,
        [candidate]: []
      }
    });
    setSelectedPose(candidate);
  }

  function renamePose(oldName: string, newName: string) {
    if (!controller) {
      return;
    }
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName || controller.poses[trimmed]) {
      return;
    }

    const nextPoses = Object.fromEntries(
      Object.entries(controller.poses).map(([key, value]) => [key === oldName ? trimmed : key, value])
    );

    onChange({
      ...controller,
      poses: nextPoses,
      defaultPoses: controller.defaultPoses.map((item) => (item === oldName ? trimmed : item))
    });
    if (selectedPose === oldName) {
      setSelectedPose(trimmed);
    }
  }

  function removePose(poseName: string) {
    if (!controller) {
      return;
    }
    const nextPoses = { ...controller.poses };
    delete nextPoses[poseName];
    onChange({
      ...controller,
      poses: nextPoses,
      defaultPoses: controller.defaultPoses.filter((item) => item !== poseName)
    });
    if (selectedPose === poseName) {
      setSelectedPose('');
    }
  }

  function updateSelectedPoseCommands(value: string) {
    if (!controller || !selectedPose) {
      return;
    }
    onChange({
      ...controller,
      poses: {
        ...controller.poses,
        [selectedPose]: toLineArray(value)
      }
    });
  }

  function removeSelectedPoseCommand(command: string) {
    if (!controller || !selectedPose) {
      return;
    }
    onChange({
      ...controller,
      poses: {
        ...controller.poses,
        [selectedPose]: (controller.poses[selectedPose] ?? []).filter((item) => item !== command)
      }
    });
  }

  function insertCommand(command: string, target: 'base' | 'pose') {
    if (!controller) {
      return;
    }

    if (target === 'base') {
      if (controller.baseLayers.includes(command)) {
        return;
      }
      onChange({
        ...controller,
        baseLayers: [...controller.baseLayers, command]
      });
      return;
    }

    if (!selectedPose) {
      return;
    }

    const current = controller.poses[selectedPose] ?? [];
    if (current.includes(command)) {
      return;
    }
    onChange({
      ...controller,
      poses: {
        ...controller.poses,
        [selectedPose]: [...current, command]
      }
    });
  }

  function removeCommand(command: string, target: 'base' | 'pose') {
    if (!controller) {
      return;
    }

    if (target === 'base') {
      removeBaseLayer(command);
      return;
    }

    if (!selectedPose) {
      return;
    }

    removeSelectedPoseCommand(command);
  }

  function hasCommand(command: string, target: 'base' | 'pose') {
    if (!controller) {
      return false;
    }

    if (target === 'base') {
      return controller.baseLayers.includes(command);
    }

    if (!selectedPose) {
      return false;
    }

    return (controller.poses[selectedPose] ?? []).includes(command);
  }

  function ensureCommand(command: string, target: 'base' | 'pose') {
    if (hasCommand(command, target)) {
      return;
    }
    insertCommand(command, target);
  }

  function previewCommand(command: string, target: 'base' | 'pose') {
    ensureCommand(command, target);
    window.setTimeout(() => {
      if (target === 'base') {
        onPreviewDefault();
        return;
      }
      if (selectedPose) {
        onPreviewPose(selectedPose);
      }
    }, 0);
  }

  async function copyJsonPreview() {
    await navigator.clipboard.writeText(exportPreview);
    setCopyStatus('JSON 已复制');
    window.setTimeout(() => setCopyStatus(''), 1500);
  }

  return (
    <section className="editor-card">
      <div className="section-header">
        <h2>Mano 编辑器</h2>
        <div className="inline-actions wrap-actions">
          <button className="ghost-button" onClick={() => void onGenerateFromPsd()} disabled={generatingPsd}>
            {generatingPsd ? '生成中...' : '从 PSD 生成'}
          </button>
          <button className="ghost-button" onClick={() => void onGenerateAi()} disabled={generatingAi || !model}>
            {generatingAi ? 'AI 生成中...' : 'AI 生成 Base/Pose'}
          </button>
          <span className="section-hint">当前文件：{modelPath ?? '-'}</span>
        </div>
      </div>

      {!model || !controller ? (
        <span className="empty-state">可以直接从 PSD 生成模型，或先加载一个 `model.char.json` 再编辑 controller</span>
      ) : (
        <>
          <div className="section-header">
            <h3>预览控制</h3>
            <div className="inline-actions wrap-actions">
              <button className="ghost-button" onClick={onPreviewDefault}>预览默认</button>
              <button className="ghost-button" onClick={() => selectedPose && onPreviewPose(selectedPose)} disabled={!selectedPose}>
                预览当前 Pose
              </button>
            </div>
          </div>

          <div className="editor-grid">
            <div className="editor-section">
              <div className="section-header">
                <h3>Base Layers</h3>
                <span className="section-hint">{controller.baseLayers.length} 条</span>
              </div>
              <div className="command-chip-list">
                {controller.baseLayers.map((command) => (
                  <div key={command} className="command-chip-item">
                    <code>{command}</code>
                    <button className="ghost-button icon-button" onClick={() => removeBaseLayer(command)}>
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <textarea
                className="editor-textarea"
                value={baseLayersText}
                onChange={(event) => updateBaseLayers(event.target.value)}
                placeholder="每行一条指令，例如 Angle01/ArmR>ArmR01"
              />
            </div>

            <div className="editor-section">
              <div className="section-header">
                <h3>Default Poses</h3>
                <button className="ghost-button" onClick={addPose}>
                  新建 Pose
                </button>
              </div>
              <div className="chip-grid compact-grid">
                {poseNames.length > 0 ? poseNames.map((poseName) => (
                  <button
                    key={poseName}
                    className={controller.defaultPoses.includes(poseName) ? 'chip active' : 'chip'}
                    onClick={() => toggleDefaultPose(poseName)}
                  >
                    {poseName}
                  </button>
                )) : <span className="empty-state">暂无 pose</span>}
              </div>
            </div>

            <div className="editor-section">
              <div className="section-header">
                <h3>Poses</h3>
                <span className="section-hint">选择后编辑指令</span>
              </div>
              <div className="pose-list">
                {poseNames.map((poseName) => (
                  <div key={poseName} className={selectedPose === poseName ? 'pose-row selected' : 'pose-row'}>
                    <button className="pose-select" onClick={() => setSelectedPose(poseName)}>
                      {poseName}
                    </button>
                    <button
                      className="ghost-button icon-button"
                      onClick={() => {
                        const next = window.prompt('新的 pose 名称', poseName);
                        if (next) {
                          renamePose(poseName, next);
                        }
                      }}
                    >
                      改名
                    </button>
                    <button className="ghost-button icon-button" onClick={() => removePose(poseName)}>
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <div className="command-chip-list">
                {selectedPoseCommands.map((command) => (
                  <div key={command} className="command-chip-item">
                    <code>{command}</code>
                    <button className="ghost-button icon-button" onClick={() => removeSelectedPoseCommand(command)}>
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <textarea
                className="editor-textarea"
                value={selectedPoseText}
                onChange={(event) => updateSelectedPoseCommands(event.target.value)}
                placeholder="每行一条 pose 指令"
              />
            </div>

            <div className="editor-section">
              <div className="section-header">
                <h3>命令库</h3>
                <span className="section-hint">点按即可插入</span>
              </div>
              <div className="command-library">
                {commandLibrary.map((entry) => (
                  <details key={entry.group} className="layer-group">
                    <summary className="layer-group-title">
                      <h3>{entry.group}</h3>
                      <span>{entry.commands.length} 条</span>
                    </summary>
                    <div className="command-actions">
                      {entry.commands.map((command) => (
                        <div key={command} className="command-row">
                          <code>{command}</code>
                          <div className="inline-actions wrap-actions">
                            <button className="ghost-button icon-button" onClick={() => previewCommand(command, 'base')}>
                              预览 Base
                            </button>
                            <button
                              className="ghost-button icon-button"
                              onClick={() => (hasCommand(command, 'base') ? removeCommand(command, 'base') : insertCommand(command, 'base'))}
                            >
                              {hasCommand(command, 'base') ? '移出 Base' : '加到 Base'}
                            </button>
                            <button
                              className="ghost-button icon-button"
                              onClick={() => previewCommand(command, 'pose')}
                              disabled={!selectedPose}
                            >
                              预览 Pose
                            </button>
                            <button
                              className="ghost-button icon-button"
                              onClick={() => (hasCommand(command, 'pose') ? removeCommand(command, 'pose') : insertCommand(command, 'pose'))}
                              disabled={!selectedPose}
                            >
                              {hasCommand(command, 'pose') ? '移出 Pose' : '加到 Pose'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </div>

          <div className="editor-section">
            <div className="section-header">
              <h3>导出预览</h3>
              <div className="inline-actions wrap-actions">
                <span className="section-hint">{copyStatus || '导出完整 mano JSON'}</span>
                <button className="ghost-button" onClick={copyJsonPreview}>
                  复制 JSON
                </button>
                <button className="primary-button compact-button" onClick={() => void onExport()}>
                  导出 mano
                </button>
              </div>
            </div>
            <textarea className="editor-textarea preview-textarea" value={exportPreview} readOnly />
          </div>
        </>
      )}
    </section>
  );
}
