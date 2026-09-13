/* Injected after the formal dashboard runtime; never persisted into offline snapshots. */
(() => {
  const config = LIVE_REVIEW_CONFIG;
  let paused = false, version = null, stopped = false, timer, controller, latest = null;
  const bar = document.createElement('aside');
  bar.id = 'liveReviewBar';
  bar.style.cssText = 'position:fixed;bottom:12px;left:16px;right:16px;z-index:100000;background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:10px 14px;box-shadow:0 4px 18px #0002;font-size:13px;display:flex;gap:12px;align-items:center';
  const status = document.createElement('span'); status.id = 'liveReviewStatus'; status.setAttribute('role', 'status'); status.style.flex = '1';
  const resume = document.createElement('button'); resume.id = 'liveReviewResume'; resume.type = 'button'; resume.textContent = '恢复指定源'; resume.hidden = true;
  bar.append(status, resume); document.body.append(bar);
  const title = config.role + '｜招聘数据复盘（实时）';
  document.title = title;
  const heading = document.querySelector('[data-dashboard-title], .app-brand span:last-child');
  if (heading) heading.textContent = title;
  document.body.dataset.workflowSynced = 'true';
  document.getElementById('stageConfigModal')?.classList.remove('active');
  document.getElementById('fileInput').disabled = false;

  function show(state, message) {
    status.dataset.state = paused ? 'paused' : state;
    if (state !== 'paused') status.dataset.connection = state;
    status.dataset.version = version || '';
    const time = latest?.updatedAt ? '最近源更新：' + new Date(latest.updatedAt).toLocaleString() + '。' : '尚未获得有效数据。';
    status.textContent = paused ? '已暂停实时覆盖：当前为手动预览。' + time + '点击恢复后返回启动时指定源。' + (['disconnected', 'error', 'waiting'].includes(state) ? ' ' + message : '') : message + ' ' + time;
    resume.hidden = !paused;
  }
  function pause() { paused = true; show('paused', ''); }
  // Capture before the existing upload handler starts asynchronous reading.
  document.addEventListener('change', event => { if (event.target.id === 'fileInput') pause(); }, true);
  document.addEventListener('click', event => {
    if (event.target.closest('#topUploadAction, #topStageConfigAction, [data-upload-entry], #fileInput')) pause();
  }, true);
  const modal = document.getElementById('stageConfigModal');
  const observer = new MutationObserver(() => { if (modal.classList.contains('active')) pause(); });
  observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  resume.addEventListener('click', () => {
    // Invalidate pending FileReader/import promises before restoring live data.
    importAttemptId += 1; pendingImportState = null; stagedUploadState = null;
    pendingUploadAfterStageConfig = false;
    document.getElementById('mappingModal')?.classList.remove('active');
    modal.classList.remove('active');
    paused = false; version = null;
    show('waiting', '正在恢复指定源。');
  });

  function apply(data) {
    if (!Array.isArray(data.rows) || !Array.isArray(data.stages) || !data.stages.length || data.role !== config.role) throw new Error('源数据不合法');
    const previous = captureImportState();
    try {
      // Reset mapping and old rows before a new pipeline is applied. Roll back the
      // complete import state if conversion rejects even one row.
      rawData = []; importedSourceRows = []; columnMapping = {}; sheetColumnMappings = {}; manualColumnMappingActive = false;
      const stages = data.stages.map((stage, code) => {
        const label = String(stage).replace(/^\d+-/, '');
        return { code, label, key: getStableSemanticKey(label) || 'custom_' + code, color: getStageColor(code), slaDays: data.slaDays?.[code] || getDefaultSlaDays({ label, key: getStableSemanticKey(label) }) };
      });
      if (!applyStageConfiguration(stages).applied) throw new Error('阶段配置无效');
      if (data.rows.length) {
        if (transformData(data.rows).length !== data.rows.length || !commitImportedRows(data.rows)) throw new Error('数据转换不完整');
      } else {
        resetDataBoundUiState(); initTimeSelectors(); refreshData();
      }
      document.getElementById('fileInput').disabled = false;
      version = data.version;
    } catch (error) {
      ({ rawData, importedSourceRows, currentAnalysisResult, columnMapping, availableColumns, currentFile, sheetColumnMappings, autoImportWarnings, manualColumnMappingActive, STAGES_CONFIG } = previous);
      refreshData(); throw error;
    }
  }
  async function poll() {
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(config.endpoint, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      if (!response.ok) throw new Error('连接失败');
      const data = await response.json();
      if (stopped) return;
      latest = data;
      if (!paused && data.status === 'ok' && data.version !== version) apply(data);
      const source = config.source === 'export' ? '持续读取启动时指定的标准导出文件。' : '持续读取启动时岗位台账。';
      show(data.status, data.status === 'ok' ? '实时已连接。' + source + '手动上传文件不会自动跟踪。' : data.message);
    } catch (error) {
      if (!stopped) show('disconnected', '连接或数据更新失败，保留当前视图；检查本地服务，连接恢复后自动重试。');
    } finally {
      clearTimeout(timeout);
      if (!stopped) timer = setTimeout(poll, config.pollIntervalMs);
    }
  }
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); controller?.abort(); observer.disconnect(); }, { once: true });
  show('waiting', '正在连接指定源。');
  poll();
})();
