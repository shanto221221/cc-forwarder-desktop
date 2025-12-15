// ============================================
// Endpoints 页面 - 端点管理
// 2025-11-28 (Updated 2025-12-06 for v5.0 SQLite Storage)
// ============================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  Globe,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Database,
  FileText,
  AlertTriangle,
  Server,
  Copy,
  ArrowRightLeft,
  Calculator,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Timer
} from 'lucide-react';
import {
  Button,
  LoadingSpinner,
  ErrorMessage
} from '@components/ui';
import useEndpointsData from '@hooks/useEndpointsData.js';
import { EndpointForm } from './components';
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
// 存储模式指示器
// ============================================

const StorageModeIndicator = ({ storageStatus }) => {
  if (!storageStatus) return null;

  const isSqlite = storageStatus.storageType === 'sqlite';

  return (
    <div className={`
      flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
      ${isSqlite
        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
        : 'bg-slate-50 text-slate-600 border border-slate-200'
      }
    `}>
      {isSqlite ? <Database size={14} /> : <FileText size={14} />}
      {isSqlite ? 'SQLite 存储模式' : 'YAML 配置模式'}
      {isSqlite && (
        <span className="text-indigo-500">
          ({storageStatus.enabledCount}/{storageStatus.totalCount} 启用)
        </span>
      )}
    </div>
  );
};

// ============================================
// 删除确认对话框
// ============================================

const DeleteConfirmDialog = ({ endpoint, onConfirm, onCancel, loading }) => (
  <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 animate-fade-in pt-[20vh]">
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-3 bg-rose-100 rounded-full">
          <AlertTriangle className="text-rose-600" size={24} />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900">确认删除</h3>
          <p className="text-sm text-slate-500">此操作不可撤销</p>
        </div>
      </div>

      <p className="text-slate-700 mb-6">
        确定要删除端点 <span className="font-semibold">"{endpoint?.name}"</span> 吗？
        删除后将无法恢复。
      </p>

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel} disabled={loading}>
          取消
        </Button>
        <Button
          variant="danger"
          icon={Trash2}
          onClick={onConfirm}
          loading={loading}
        >
          确认删除
        </Button>
      </div>
    </div>
  </div>
);

// ============================================
// 端点表格行组件 (v5.0 增强版 - 参考 test.jsx 设计)
// ============================================

// 健康状态徽章
const HealthBadge = ({ healthy, neverChecked }) => {
  if (neverChecked) {
    return (
      <div className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-50 text-slate-400 border border-slate-200">
        <Clock size={10} className="mr-1" />
        未检测
      </div>
    );
  }

  return healthy ? (
    <div className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-100">
      <CheckCircle2 size={10} className="mr-1" />
      健康
    </div>
  ) : (
    <div className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-600 border border-rose-100">
      <XCircle size={10} className="mr-1" />
      异常
    </div>
  );
};

// 冷却状态徽章
const CooldownBadge = ({ inCooldown, cooldownUntil, cooldownReason }) => {
  if (!inCooldown) return null;

  // 格式化剩余冷却时间
  const formatRemainingTime = (until) => {
    if (!until) return '';
    try {
      const endTime = new Date(until);
      const now = new Date();
      const diffMs = endTime - now;
      if (diffMs <= 0) return '即将恢复';
      const diffMins = Math.ceil(diffMs / 60000);
      if (diffMins < 60) return `${diffMins}分钟`;
      const diffHours = Math.floor(diffMins / 60);
      return `${diffHours}小时${diffMins % 60}分`;
    } catch {
      return '';
    }
  };

  return (
    <div
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-200 cursor-help"
      title={`冷却原因: ${cooldownReason || '请求失败'}\n恢复时间: ${cooldownUntil}`}
    >
      <Timer size={10} className="mr-1 animate-pulse" />
      冷却中 {formatRemainingTime(cooldownUntil)}
    </div>
  );
};

// 延迟指示器
const LatencyBadge = ({ ms }) => {
  if (!ms || ms === 0) return <span className="text-slate-300 text-xs">-</span>;

  let colorClass = 'text-emerald-600 bg-emerald-50 border-emerald-100';
  if (ms > 500) colorClass = 'text-amber-600 bg-amber-50 border-amber-100';
  if (ms > 1000) colorClass = 'text-rose-600 bg-rose-50 border-rose-100';

  return (
    <span className={`font-mono text-xs font-medium px-2 py-0.5 rounded border ${colorClass}`}>
      {ms}ms
    </span>
  );
};

const EndpointRow = ({
  endpoint,
  storageMode,
  onActivateGroup,
  onEdit,
  onDelete,
  onToggle
}) => {
  if (!endpoint) return null;

  // 格式化最后检查时间
  const formatLastCheck = (time) => {
    if (!time || time === '-') return '-';
    try {
      const date = new Date(time);
      return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return time;
    }
  };

  const isSqliteMode = storageMode === 'sqlite';
  const isActive = isSqliteMode ? endpoint.enabled : endpoint.group_is_active;
  const responseTime = endpoint.response_time || endpoint.responseTimeMs || 0;
  const isNeverChecked = endpoint.never_checked || !endpoint.lastCheck && !endpoint.last_check && !endpoint.updatedAt;

  // 获取认证类型显示
  const getAuthType = () => {
    if (endpoint.token || endpoint.tokenMasked) return 'Token';
    if (endpoint.apiKey) return 'API Key';
    return null;
  };

  return (
    <tr className={`transition-colors group ${isActive ? 'hover:bg-slate-50/50' : 'bg-slate-50/30 opacity-70'}`}>
      {/* 启用状态 Toggle */}
      <td className="px-6 py-4">
        <div
          className="cursor-pointer"
          onClick={() => {
            if (isSqliteMode) {
              onToggle?.(endpoint.name, !isActive);
            } else {
              onActivateGroup?.(endpoint.name, endpoint.group);
            }
          }}
        >
          {isActive ? (
            <div className="w-10 h-6 bg-emerald-500 rounded-full relative transition-colors shadow-inner">
              <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm"></div>
            </div>
          ) : (
            <div className="w-10 h-6 bg-slate-200 rounded-full relative transition-colors shadow-inner">
              <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm"></div>
            </div>
          )}
        </div>
      </td>

      {/* 渠道 / 名称 / 健康状态 */}
      <td className="px-6 py-4">
        <div className="flex flex-col space-y-1.5">
          <span className="font-bold text-slate-900 text-sm">{endpoint.name}</span>
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100">
              {endpoint.channel || endpoint.group || '-'}
            </span>
            <HealthBadge healthy={endpoint.healthy} neverChecked={isNeverChecked} />
            <CooldownBadge
              inCooldown={endpoint.in_cooldown || endpoint.inCooldown}
              cooldownUntil={endpoint.cooldown_until || endpoint.cooldownUntil}
              cooldownReason={endpoint.cooldown_reason || endpoint.cooldownReason}
            />
          </div>
        </div>
      </td>

      {/* URL / 认证 */}
      <td className="px-6 py-4">
        <div className="flex flex-col space-y-1.5">
          <div className="flex items-center text-slate-500 max-w-[240px]" title={endpoint.url}>
            <Globe size={12} className="mr-1.5 text-slate-400 flex-shrink-0" />
            <span className="truncate text-xs font-mono">{endpoint.url}</span>
          </div>
          {getAuthType() && (
            <div className="flex items-center">
              <div className="flex items-center text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                <ShieldCheck size={10} className="mr-1 text-amber-500" />
                已配置 {getAuthType()}
              </div>
            </div>
          )}
        </div>
      </td>

      {/* 优先级 */}
      <td className="px-6 py-4 text-center">
        <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-50 border border-slate-200 font-bold text-slate-600 text-xs">
          {endpoint.priority || 1}
        </div>
      </td>

      {/* 高级特性 */}
      <td className="px-6 py-4">
        <div className="flex items-center space-x-2">
          <div
            className={`p-1.5 rounded-md ${endpoint.failoverEnabled !== false ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-300'}`}
            title="故障转移"
          >
            <ArrowRightLeft size={14} />
          </div>
          <div
            className={`p-1.5 rounded-md ${endpoint.supportsCountTokens ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-300'}`}
            title="支持 Token 计数"
          >
            <Calculator size={14} />
          </div>
        </div>
      </td>

      {/* 响应延迟 */}
      <td className="px-6 py-4 text-center">
        <LatencyBadge ms={responseTime} />
      </td>

      {/* 倍率 */}
      <td className="px-6 py-4 text-center">
        <span className={`text-xs font-mono font-medium px-2 py-1 rounded ${
          (endpoint.costMultiplier || 1) > 1.0
            ? 'bg-orange-50 text-orange-600 border border-orange-100'
            : 'text-slate-500 bg-slate-50'
        }`}>
          {endpoint.costMultiplier || 1.0}x
        </span>
      </td>

      {/* 最后检查 */}
      <td className="px-6 py-4 text-slate-400 font-mono text-xs">
        {formatLastCheck(endpoint.lastCheck || endpoint.last_check || endpoint.updatedAt)}
      </td>

      {/* 操作 */}
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end space-x-1">
          <button
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(endpoint, null, 2));
            }}
            className="p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 rounded-md transition-colors"
            title="复制配置"
          >
            <Copy size={14} />
          </button>
          {isSqliteMode && (
            <>
              <button
                onClick={() => onEdit?.(endpoint)}
                className="p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 rounded-md transition-colors"
                title="编辑"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => onDelete?.(endpoint)}
                className="p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 rounded-md transition-colors"
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
};

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
    keysOverview,
    refresh,
    performBatchHealthCheckAll,
    activateEndpointGroup,
    switchKey,
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

  // 从 keysOverview 中查找指定端点的 Key 信息
  const getKeysInfo = (endpointName) => {
    if (!keysOverview?.endpoints) return null;
    return keysOverview.endpoints.find(k => k.endpoint === endpointName);
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
          {/* 存储模式指示器 - 已隐藏 */}
          {/* <StorageModeIndicator storageStatus={storageStatus} /> */}

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
                displayEndpoints.map((endpoint, index) => (
                  <EndpointRow
                    key={endpoint.name || index}
                    endpoint={endpoint}
                    storageMode={isSqliteMode ? 'sqlite' : 'yaml'}
                    onActivateGroup={activateEndpointGroup}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onToggle={handleToggle}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center">
          <div className="text-xs text-slate-500">
            显示 1 到 {displayEndpoints.length} 条，共 {displayEndpoints.length} 条记录
            {displayStats.healthPercentage > 0 && (
              <span className="ml-2 text-emerald-600">
                · {displayStats.healthPercentage}% 健康率
              </span>
            )}
          </div>
          <div className="flex space-x-2">
            <button
              className="px-3 py-1 border border-slate-200 rounded text-xs text-slate-400 disabled:opacity-50"
              disabled
            >
              上一页
            </button>
            <button
              className="px-3 py-1 border border-slate-200 rounded text-xs text-slate-600 hover:bg-slate-50"
            >
              下一页
            </button>
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
