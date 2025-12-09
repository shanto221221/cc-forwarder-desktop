// useWailsLogs.js - Wails 日志流 Hook
// 提供实时日志查看功能
import { useState, useEffect, useCallback, useRef } from 'react';
import { EventsOn, EventsOff } from '@wailsjs/runtime';
import {
  GetRecentLogs,
  StartLogStream,
  StopLogStream,
  GetLogStreamStatus
} from '@wailsjs/go/main/App';

/**
 * useWailsLogs Hook
 * @param {Object} options 配置选项
 * @param {number} options.maxLogs 最大日志条数（默认500）
 * @param {boolean} options.autoStart 是否自动启动流（默认true）
 * @param {string} options.levelFilter 日志级别过滤（默认null，显示全部）
 * @param {boolean} options.isActive 页面是否可见（默认true）
 * @returns {Object} { logs, loading, error, isStreaming, start, stop, clear, refresh }
 */
export function useWailsLogs(options = {}) {
  const {
    maxLogs = 500,
    autoStart = true,
    levelFilter = null,
    isActive = true, // 新增：页面可见性
  } = options;

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const unsubscribeRef = useRef(null);
  const isMountedRef = useRef(true);

  // 日志级别过滤
  const filterLogs = useCallback((logList) => {
    if (!levelFilter) return logList;
    return logList.filter(log => log.level === levelFilter);
  }, [levelFilter]);

  // 加载历史日志
  const loadRecentLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const recentLogs = await GetRecentLogs(maxLogs);
      if (isMountedRef.current) {
        setLogs(filterLogs(recentLogs || []));
      }
    } catch (err) {
      console.error('❌ 加载历史日志失败:', err);
      if (isMountedRef.current) {
        setError(err.message || '加载失败');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [maxLogs, filterLogs]);

  // 启动日志流
  const startStreaming = useCallback(async () => {
    try {
      // 先用 EventsOff 显式取消所有 log:batch 订阅，避免重复
      EventsOff('log:batch');
      unsubscribeRef.current = null;

      // 检查是否已经在流式传输
      const status = await GetLogStreamStatus();
      if (!status) {
        await StartLogStream();
      }

      if (isMountedRef.current) {
        setIsStreaming(true);
      }

      // 订阅日志事件（批量）
      const unsubscribe = EventsOn('log:batch', (batchLogs) => {
        if (!isMountedRef.current) return;

        setLogs(prevLogs => {
          // 合并新日志，限制总数
          const newLogs = [...prevLogs, ...batchLogs];
          return filterLogs(newLogs.slice(-maxLogs));
        });
      });

      unsubscribeRef.current = unsubscribe;
    } catch (err) {
      console.error('❌ 启动日志流失败:', err);
      if (isMountedRef.current) {
        setError(err.message || '启动失败');
      }
    }
  }, [maxLogs, filterLogs]);

  // 停止日志流
  const stopStreaming = useCallback(async () => {
    try {
      // 用 EventsOff 显式取消所有 log:batch 订阅
      EventsOff('log:batch');
      unsubscribeRef.current = null;

      // 再停止后端流（检查是否正在运行）
      const isRunning = await GetLogStreamStatus();
      if (isRunning) {
        await StopLogStream();
      }

      if (isMountedRef.current) {
        setIsStreaming(false);
      }
    } catch (err) {
      console.error('❌ 停止日志流失败:', err);
    }
  }, []);

  // 清空日志
  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // 刷新日志
  const refresh = useCallback(async () => {
    await loadRecentLogs();
  }, [loadRecentLogs]);

  // 初始化
  useEffect(() => {
    isMountedRef.current = true;

    // 1. 加载历史日志
    loadRecentLogs();

    // 2. 自动启动流
    if (autoStart) {
      startStreaming();
    }

    // 清理
    return () => {
      isMountedRef.current = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      // 停止流
      stopStreaming();
    };
  }, [autoStart, loadRecentLogs, startStreaming, stopStreaming]);

  // 页面可见性控制：当页面不可见时停止监听，节省资源
  useEffect(() => {
    if (!isActive && isStreaming) {
      // 页面不可见，停止监听
      console.log('📴 日志页面不可见，停止日志流');
      stopStreaming();
    } else if (isActive && !isStreaming && autoStart) {
      // 页面重新可见，重新启动
      console.log('📡 日志页面可见，重新启动日志流');
      startStreaming();
    }
  }, [isActive, isStreaming, autoStart, startStreaming, stopStreaming]);

  return {
    logs,
    loading,
    error,
    isStreaming,
    start: startStreaming,
    stop: stopStreaming,
    clear: clearLogs,
    refresh,
  };
}

export default useWailsLogs;
