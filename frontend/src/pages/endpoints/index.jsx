// ============================================
// Endpoints 页面 - 端点管理
// 2025-11-28 (Updated 2025-12-17 for channel grouping)
// ============================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  RefreshCw,
  Database,
  Server,
  ChevronsUpDown
} from 'lucide-react';
import {
  Button,
  LoadingSpinner,
  ErrorMessage
} from '@components/ui';
import useEndpointsData from '@hooks/useEndpointsData.js';
import {
  EndpointForm,
  EndpointRow,
  ChannelRow,
  DeleteConfirmDialog,
  groupEndpointsByChannel
} from './components';
import {
  getEndpointStorageStatus,
  getEndpointRecords,
  createEndpointRecord,
  updateEndpointRecord,
  deleteEndpointRecord,
  toggleEndpointRecord,
  isWailsEnvironment,
  subscribeToEvent
} from '@utils/wailsApi.js';

// ============================================
// Endpoints 页面
// ============================================

const EndpointsPage = () => {
  // 使用端点数据 Hook
  const {
    endpoints,
    loading,
    error,
    stats,
    refresh,
    performBatchHealthCheckAll,
    activateEndpointGroup,
    sseConnectionStatus,
    lastUpdate
  } = useEndpointsData();

  // 存储模式状态
  const [storageStatus, setStorageStatus] = useState(null);
  const [storageEndpoints, setStorageEndpoints] = useState([]);

  // 批量检测状态
  const [batchCheckLoading, setBatchCheckLoading] = useState(false);

  // 表单状态
  const [showForm, setShowForm] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 渠道折叠状态
  const [expandedChannels, setExpandedChannels] = useState(new Set());

  // 加载存储状态
  const loadStorageStatus = useCallback(async () => {
    try {
      const status = await getEndpointStorageStatus();
      setStorageStatus(status);

      // 如果是 SQLite 模式，加载存储的端点
      if (status.storageType === 'sqlite' && status.enabled) {
        const records = await getEndpointRecords();
        setStorageEndpoints(records);
      }
    } catch (err) {
      console.error('获取存储状态失败:', err);
      // 默认使用 YAML 模式
      setStorageStatus({ enabled: false, storageType: 'yaml' });
    }
  }, []);

  // 初始化加载存储状态
  useEffect(() => {
    loadStorageStatus();
  }, [loadStorageStatus]);

  // SQLite 模式下监听 Wails 事件，实时刷新端点数据
  const isSqliteModeRef = useRef(false);
  useEffect(() => {
    isSqliteModeRef.current = storageStatus?.storageType === 'sqlite' && storageStatus?.enabled;
  }, [storageStatus]);

  useEffect(() => {
    if (!isWailsEnvironment()) return;

    // 订阅端点更新事件
    const unsubscribe = subscribeToEvent('endpoint:update', () => {
      // 只在 SQLite 模式下刷新数据
      if (isSqliteModeRef.current) {
        console.log('📡 [Endpoints] 收到端点更新事件，刷新 SQLite 数据');
        loadStorageStatus();
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [loadStorageStatus]);

  // 批量健康检测处理
  const handleBatchHealthCheck = async () => {
    setBatchCheckLoading(true);
    try {
      await performBatchHealthCheckAll();
      // 刷新数据以获取最新的健康状态、响应时间等
      if (isSqliteMode) {
        await loadStorageStatus();
      }
    } catch (err) {
      console.error('批量健康检测失败:', err);
      alert(`批量健康检测失败: ${err.message}`);
    } finally {
      setBatchCheckLoading(false);
    }
  };

  // 判断存储模式
  const isSqliteMode = storageStatus?.storageType === 'sqlite' && storageStatus?.enabled;

  // 获取要显示的端点列表
  const displayEndpoints = isSqliteMode ? storageEndpoints : endpoints;

  // 计算统计数据
  const displayStats = isSqliteMode
    ? {
        total: storageEndpoints.length,
        healthy: storageEndpoints.filter(e => e.healthy).length,
        unhealthy: storageEndpoints.filter(e => !e.healthy && e.lastCheck).length,
        unchecked: storageEndpoints.filter(e => !e.lastCheck).length,
        cooldown: storageEndpoints.filter(e => e.in_cooldown || e.inCooldown).length,
        healthPercentage: storageEndpoints.length > 0
          ? ((storageEndpoints.filter(e => e.healthy).length / storageEndpoints.length) * 100).toFixed(1)
          : 0
      }
    : { ...stats, cooldown: 0 };

  // 按渠道分组
  const groupedEndpoints = groupEndpointsByChannel(displayEndpoints);

  // 切换渠道展开状态
  const toggleChannel = (channel) => {
    setExpandedChannels(prev => {
      const next = new Set(prev);
      if (next.has(channel)) {
        next.delete(channel);
      } else {
        next.add(channel);
      }
      return next;
    });
  };

  // 全部展开/折叠
  const toggleAllChannels = () => {
    const allChannels = new Set(displayEndpoints.map(e => e.channel || e.group || '未分组'));
    if (expandedChannels.size === allChannels.size) {
      // 当前全部展开，则全部折叠
      setExpandedChannels(new Set());
    } else {
      // 否则全部展开
      setExpandedChannels(allChannels);
    }
  };

  // 判断是否全部展开
  const isAllExpanded = () => {
    const allChannels = new Set(displayEndpoints.map(e => e.channel || e.group || '未分组'));
    return expandedChannels.size === allChannels.size;
  };

  // 首次加载时默认展开所有渠道
  useEffect(() => {
    if (displayEndpoints.length > 0 && expandedChannels.size === 0) {
      const channels = new Set(displayEndpoints.map(e => e.channel || e.group || '未分组'));
      setExpandedChannels(channels);
    }
  }, [displayEndpoints]);

  // ============================================
  // CRUD 操作处理
  // ============================================

  // 新建端点
  const handleCreate = () => {
    setEditingEndpoint(null);
    setShowForm(true);
  };

  // 编辑端点
  const handleEdit = (endpoint) => {
    setEditingEndpoint(endpoint);
    setShowForm(true);
  };

  // 删除端点
  const handleDelete = (endpoint) => {
    setDeleteTarget(endpoint);
  };

  // 切换端点启用状态
  const handleToggle = async (name, enabled) => {
    try {
      await toggleEndpointRecord(name, enabled);
      // 刷新列表
      await loadStorageStatus();
    } catch (err) {
      console.error('切换端点状态失败:', err);
      alert(`操作失败: ${err.message}`);
    }
  };

  // 保存端点
  const handleSave = async (formData) => {
    setFormLoading(true);
    try {
      if (editingEndpoint) {
        // 编辑模式
        await updateEndpointRecord(editingEndpoint.name, formData);
      } else {
        // 新建模式
        await createEndpointRecord(formData);
      }
      setShowForm(false);
      setEditingEndpoint(null);
      // 刷新列表
      await loadStorageStatus();
    } catch (err) {
      console.error('保存失败:', err);
      throw err;
    } finally {
      setFormLoading(false);
    }
  };

  // 确认删除
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    setDeleteLoading(true);
    try {
      await deleteEndpointRecord(deleteTarget.name);
      setDeleteTarget(null);
      // 刷新列表
      await loadStorageStatus();
    } catch (err) {
      console.error('删除失败:', err);
      alert(`删除失败: ${err.message}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  // 错误状态
  if (error && !isSqliteMode) {
    return (
      <ErrorMessage
        title="端点数据加载失败"
        message={error}
        onRetry={refresh}
      />
    );
  }

  // 加载状态
  if (loading && displayEndpoints.length === 0 && !storageStatus) {
    return <LoadingSpinner text="加载端点数据..." />;
  }

  return (
    <div className="animate-fade-in">
      {/* 页面标题 */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Endpoints Management</h1>
          <p className="text-slate-500 text-sm mt-1">
            管理上游 API 端点配置、认证与路由策略
            {lastUpdate && (
              <span className="ml-2 text-slate-400">· 更新于 {lastUpdate}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* SSE 状态指示器 */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`w-2 h-2 rounded-full ${
              sseConnectionStatus === 'connected' ? 'bg-emerald-400' :
              sseConnectionStatus === 'connecting' ? 'bg-amber-400 animate-pulse' :
              'bg-slate-300'
            }`} />
            {sseConnectionStatus === 'connected' ? '实时' : '离线'}
          </div>

          {/* 刷新按钮 */}
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            onClick={isSqliteMode ? loadStorageStatus : refresh}
            loading={loading}
          >
            刷新
          </Button>

          {/* 批量检测按钮 */}
          <Button
            icon={Activity}
            loading={batchCheckLoading}
            onClick={handleBatchHealthCheck}
          >
            检测全部
          </Button>

          {/* 新建端点按钮 (SQLite 模式) */}
          {isSqliteMode && (
            <Button
              icon={Server}
              onClick={handleCreate}
            >
              添加端点
            </Button>
          )}
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200/60 p-4 shadow-sm">
          <div className="text-2xl font-bold text-slate-900">{displayStats.total}</div>
          <div className="text-sm text-slate-500">总端点数</div>
        </div>
        {isSqliteMode && (
          <div className="bg-white rounded-xl border border-indigo-200/60 p-4 shadow-sm">
            <div className="text-2xl font-bold text-indigo-600">
              {storageEndpoints.filter(e => e.enabled).length}
            </div>
            <div className="text-sm text-slate-500">
              当前激活
              {storageEndpoints.find(e => e.enabled) && (
                <div className="text-xs text-indigo-500 mt-1 truncate">
                  {storageEndpoints.find(e => e.enabled).name}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="bg-white rounded-xl border border-emerald-200/60 p-4 shadow-sm">
          <div className="text-2xl font-bold text-emerald-600">{displayStats.healthy}</div>
          <div className="text-sm text-slate-500">健康端点</div>
        </div>
        <div className="bg-white rounded-xl border border-rose-200/60 p-4 shadow-sm">
          <div className="text-2xl font-bold text-rose-600">{displayStats.unhealthy}</div>
          <div className="text-sm text-slate-500">不健康端点</div>
        </div>
        {/* 冷却中端点卡片 - 仅在有冷却端点时显示 */}
        {displayStats.cooldown > 0 && (
          <div className="bg-white rounded-xl border border-amber-200/60 p-4 shadow-sm">
            <div className="text-2xl font-bold text-amber-600">{displayStats.cooldown}</div>
            <div className="text-sm text-slate-500">冷却中</div>
          </div>
        )}
        <div className="bg-white rounded-xl border border-slate-200/60 p-4 shadow-sm">
          <div className="text-2xl font-bold text-slate-400">{displayStats.unchecked}</div>
          <div className="text-sm text-slate-500">未检测端点</div>
        </div>
      </div>

      {/* 端点表格 */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
        {/* 表格工具栏 */}
        <div className="px-6 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="text-sm text-slate-600 font-medium">
            {groupedEndpoints.length} 个渠道
          </div>
          <button
            onClick={toggleAllChannels}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ChevronsUpDown size={14} />
            {isAllExpanded() ? '全部折叠' : '全部展开'}
          </button>
        </div>

        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50/80 text-xs uppercase font-semibold text-slate-500 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 w-24">启用</th>
                <th className="px-6 py-4">渠道 / 名称</th>
                <th className="px-6 py-4">URL / 认证</th>
                <th className="px-6 py-4 text-center">优先级</th>
                <th className="px-6 py-4">高级特性</th>
                <th className="px-6 py-4 text-center">延迟</th>
                <th className="px-6 py-4 text-center">倍率</th>
                <th className="px-6 py-4">最后检查</th>
                <th className="px-6 py-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayEndpoints.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-500">
                    {isSqliteMode ? (
                      <div className="flex flex-col items-center gap-3">
                        <Database size={40} className="text-slate-300" />
                        <p>暂无端点配置</p>
                        <Button icon={Server} onClick={handleCreate}>
                          添加第一个端点
                        </Button>
                      </div>
                    ) : (
                      '暂无端点数据'
                    )}
                  </td>
                </tr>
              ) : (
                groupedEndpoints.map(({ channel, endpoints: channelEndpoints }) => (
                  <React.Fragment key={channel}>
                    <ChannelRow
                      channel={channel}
                      endpoints={channelEndpoints}
                      expanded={expandedChannels.has(channel)}
                      onToggle={() => toggleChannel(channel)}
                      storageMode={isSqliteMode ? 'sqlite' : 'yaml'}
                    />
                    {expandedChannels.has(channel) && channelEndpoints.map((endpoint, index) => (
                      <EndpointRow
                        key={endpoint.name || index}
                        endpoint={endpoint}
                        storageMode={isSqliteMode ? 'sqlite' : 'yaml'}
                        onActivateGroup={activateEndpointGroup}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onToggle={handleToggle}
                        isGrouped={true}
                      />
                    ))}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center">
          <div className="text-xs text-slate-500">
            显示 {groupedEndpoints.length} 个渠道，共 {displayEndpoints.length} 个端点
            {displayStats.healthPercentage > 0 && (
              <span className="ml-2 text-emerald-600">
                · {displayStats.healthPercentage}% 健康率
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 端点表单弹窗 */}
      {showForm && (
        <EndpointForm
          endpoint={editingEndpoint}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditingEndpoint(null);
          }}
          loading={formLoading}
        />
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          endpoint={deleteTarget}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
          loading={deleteLoading}
        />
      )}
    </div>
  );
};

export default EndpointsPage;
