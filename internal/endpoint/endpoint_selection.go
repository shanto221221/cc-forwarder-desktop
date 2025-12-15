// endpoint_selection.go - 端点选择/路由功能
// 包含健康端点获取、故障转移端点选择、排序策略等

package endpoint

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"
)

// GetHealthyEndpoints returns a list of healthy endpoints from active groups based on strategy
// v5.0 Desktop: 支持故障转移 - 活跃端点不健康时，返回其他 failover_enabled=true 的健康端点
func (m *Manager) GetHealthyEndpoints() []*Endpoint {
	// v5.0+: 使用快照机制
	m.endpointsMu.RLock()
	snapshot := make([]*Endpoint, len(m.endpoints))
	copy(snapshot, m.endpoints)
	m.endpointsMu.RUnlock()

	// 1. 首先尝试获取活跃组（用户激活的端点）的健康端点
	activeEndpoints := m.groupManager.FilterEndpointsByActiveGroups(snapshot)

	now := time.Now()
	var healthy []*Endpoint
	for _, endpoint := range activeEndpoints {
		endpoint.mutex.RLock()
		isHealthy := endpoint.Status.Healthy
		// 检查是否在请求冷却中
		inCooldown := !endpoint.Status.CooldownUntil.IsZero() && now.Before(endpoint.Status.CooldownUntil)
		endpoint.mutex.RUnlock()

		if isHealthy && !inCooldown {
			healthy = append(healthy, endpoint)
		} else if inCooldown {
			slog.Debug(fmt.Sprintf("⏭️ [端点选择] 跳过冷却中的端点: %s", endpoint.Config.Name))
		}
	}

	// 2. 如果活跃端点健康且不在冷却中，直接返回
	if len(healthy) > 0 {
		return m.sortHealthyEndpoints(healthy, true)
	}

	// 3. 活跃端点不健康或在冷却中，尝试故障转移
	if !m.config.Failover.Enabled {
		return healthy // 故障转移未启用，返回空列表
	}

	slog.Info("🔄 [故障转移] 活跃端点不可用（不健康或在冷却中），尝试故障转移到其他端点")
	healthy = m.getFailoverEndpoints(activeEndpoints, snapshot)

	if len(healthy) > 0 {
		slog.Info(fmt.Sprintf("✅ [故障转移] 找到 %d 个可用的故障转移端点", len(healthy)))
	}

	return m.sortHealthyEndpoints(healthy, true) // 按策略排序
}

// getFailoverEndpoints 获取故障转移端点（排除活跃端点）
// 返回所有 failover_enabled=true 且健康且不在冷却中的非活跃端点
func (m *Manager) getFailoverEndpoints(activeEndpoints, snapshot []*Endpoint) []*Endpoint {
	// 构建活跃端点名称集合
	activeNames := make(map[string]bool, len(activeEndpoints))
	for _, ep := range activeEndpoints {
		activeNames[ep.Config.Name] = true
	}

	now := time.Now()
	var failoverEndpoints []*Endpoint
	for _, endpoint := range snapshot {
		// 跳过活跃端点（已经检查过了）
		if activeNames[endpoint.Config.Name] {
			continue
		}

		// 检查是否参与故障转移（默认为 true）
		failoverEnabled := true
		if endpoint.Config.FailoverEnabled != nil {
			failoverEnabled = *endpoint.Config.FailoverEnabled
		}
		if !failoverEnabled {
			continue
		}

		// 检查健康状态和冷却状态
		endpoint.mutex.RLock()
		isHealthy := endpoint.Status.Healthy
		inCooldown := !endpoint.Status.CooldownUntil.IsZero() && now.Before(endpoint.Status.CooldownUntil)
		endpoint.mutex.RUnlock()

		if inCooldown {
			slog.Debug(fmt.Sprintf("⏭️ [故障转移] 跳过冷却中的端点: %s", endpoint.Config.Name))
			continue
		}

		if isHealthy {
			failoverEndpoints = append(failoverEndpoints, endpoint)
		}
	}

	return failoverEndpoints
}

// sortHealthyEndpoints sorts healthy endpoints based on strategy with optional logging
func (m *Manager) sortHealthyEndpoints(healthy []*Endpoint, showLogs bool) []*Endpoint {
	// Sort based on strategy
	switch m.config.Strategy.Type {
	case "priority":
		sort.Slice(healthy, func(i, j int) bool {
			return healthy[i].Config.Priority < healthy[j].Config.Priority
		})
	case "fastest":
		// Log endpoint latencies for fastest strategy (only if showLogs is true)
		if len(healthy) > 1 && showLogs {
			slog.Info("📊 [Fastest Strategy] 基于健康检查的端点延迟排序:")
			for _, ep := range healthy {
				ep.mutex.RLock()
				responseTime := ep.Status.ResponseTime
				ep.mutex.RUnlock()
				slog.Info(fmt.Sprintf("  ⏱️ %s - 延迟: %dms (来源: 定期健康检查)",
					ep.Config.Name, responseTime.Milliseconds()))
			}
		}

		sort.Slice(healthy, func(i, j int) bool {
			healthy[i].mutex.RLock()
			healthy[j].mutex.RLock()
			defer healthy[i].mutex.RUnlock()
			defer healthy[j].mutex.RUnlock()
			return healthy[i].Status.ResponseTime < healthy[j].Status.ResponseTime
		})
	}

	return healthy
}

// GetFastestEndpointsWithRealTimeTest returns endpoints from active groups sorted by real-time testing
// v5.0 Desktop: 支持故障转移 - 活跃端点不健康时，返回其他 failover_enabled=true 的健康端点
func (m *Manager) GetFastestEndpointsWithRealTimeTest(ctx context.Context) []*Endpoint {
	// v5.0+: 使用快照机制
	m.endpointsMu.RLock()
	snapshot := make([]*Endpoint, len(m.endpoints))
	copy(snapshot, m.endpoints)
	m.endpointsMu.RUnlock()

	// 1. 首先尝试获取活跃组（用户激活的端点）的健康端点
	activeEndpoints := m.groupManager.FilterEndpointsByActiveGroups(snapshot)

	var healthy []*Endpoint
	for _, endpoint := range activeEndpoints {
		endpoint.mutex.RLock()
		if endpoint.Status.Healthy {
			healthy = append(healthy, endpoint)
		}
		endpoint.mutex.RUnlock()
	}

	// 2. 如果活跃端点不健康，尝试故障转移
	if len(healthy) == 0 && m.config.Failover.Enabled {
		slog.InfoContext(ctx, "🔄 [故障转移] 活跃端点不健康，尝试故障转移到其他端点")
		healthy = m.getFailoverEndpoints(activeEndpoints, snapshot)

		if len(healthy) > 0 {
			slog.InfoContext(ctx, fmt.Sprintf("✅ [故障转移] 找到 %d 个可用的故障转移端点", len(healthy)))
		}
	}

	if len(healthy) == 0 {
		return healthy
	}

	// If not using fastest strategy or fast test disabled, apply sorting with logging
	if m.config.Strategy.Type != "fastest" || !m.config.Strategy.FastTestEnabled {
		return m.sortHealthyEndpoints(healthy, true) // Show logs
	}

	// Check if we have cached fast test results first
	testResults, usedCache := m.fastTester.TestEndpointsParallel(ctx, healthy)

	// Only show health check sorting if we're NOT using cache
	if !usedCache && m.config.Strategy.Type == "fastest" && len(healthy) > 1 {
		slog.InfoContext(ctx, "📊 [Fastest Strategy] 基于健康检查的活跃组端点延迟排序:")
		for _, ep := range healthy {
			ep.mutex.RLock()
			responseTime := ep.Status.ResponseTime
			group := ep.Config.Group
			ep.mutex.RUnlock()
			slog.InfoContext(ctx, fmt.Sprintf("  ⏱️ %s (组: %s) - 延迟: %dms (来源: 定期健康检查)",
				ep.Config.Name, group, responseTime.Milliseconds()))
		}
	}

	// Log ALL test results first (including failures) - but only if cache wasn't used
	if len(testResults) > 0 && !usedCache {
		slog.InfoContext(ctx, "🔍 [Fastest Response Mode] 活跃组端点性能测试结果:")
		successCount := 0
		for _, result := range testResults {
			group := result.Endpoint.Config.Group
			if result.Success {
				successCount++
				slog.InfoContext(ctx, fmt.Sprintf("  ✅ 健康 %s (组: %s) - 响应时间: %dms",
					result.Endpoint.Config.Name, group,
					result.ResponseTime.Milliseconds()))
			} else {
				errorMsg := ""
				if result.Error != nil {
					errorMsg = fmt.Sprintf(" - 错误: %s", result.Error.Error())
				}
				slog.InfoContext(ctx, fmt.Sprintf("  ❌ 异常 %s (组: %s) - 响应时间: %dms%s",
					result.Endpoint.Config.Name, group,
					result.ResponseTime.Milliseconds(),
					errorMsg))
			}
		}

		slog.InfoContext(ctx, fmt.Sprintf("📊 [测试摘要] 活跃组测试: %d个端点, 健康: %d个, 异常: %d个",
			len(testResults), successCount, len(testResults)-successCount))
	}

	// Sort by response time (only successful results)
	sortedResults := SortByResponseTime(testResults)

	if len(sortedResults) == 0 {
		slog.WarnContext(ctx, "⚠️ [Fastest Response Mode] 活跃组所有端点测试失败，回退到健康检查模式")
		return healthy // Fall back to health check results if no fast tests succeeded
	}

	// Convert back to endpoint slice
	endpoints := make([]*Endpoint, 0, len(sortedResults))
	for _, result := range sortedResults {
		endpoints = append(endpoints, result.Endpoint)
	}

	// Log the successful endpoint ranking
	if len(endpoints) > 0 {
		// Show the fastest endpoint selection
		fastestEndpoint := endpoints[0]
		var fastestTime int64
		for _, result := range sortedResults {
			if result.Endpoint == fastestEndpoint {
				fastestTime = result.ResponseTime.Milliseconds()
				break
			}
		}

		cacheIndicator := ""
		if usedCache {
			cacheIndicator = " (缓存)"
		}

		slog.InfoContext(ctx, fmt.Sprintf("🚀 [Fastest Response Mode] 选择最快端点: %s - %dms%s",
			fastestEndpoint.Config.Name, fastestTime, cacheIndicator))

		// Show other available endpoints if there are more than one
		if len(endpoints) > 1 && !usedCache {
			slog.InfoContext(ctx, "📋 [备用端点] 其他可用端点:")
			for i := 1; i < len(endpoints); i++ {
				ep := endpoints[i]
				var responseTime int64
				var epGroup string
				for _, result := range sortedResults {
					if result.Endpoint == ep {
						responseTime = result.ResponseTime.Milliseconds()
						epGroup = result.Endpoint.Config.Group
						break
					}
				}
				slog.InfoContext(ctx, fmt.Sprintf("  🔄 备用 %s (组: %s) - 响应时间: %dms",
					ep.Config.Name, epGroup, responseTime))
			}
		}
	}

	return endpoints
}

// GetEndpointByName returns an endpoint by name, only from active groups
func (m *Manager) GetEndpointByName(name string) *Endpoint {
	// v5.0+: 使用快照机制
	m.endpointsMu.RLock()
	snapshot := make([]*Endpoint, len(m.endpoints))
	copy(snapshot, m.endpoints)
	m.endpointsMu.RUnlock()

	// First filter by active groups
	activeEndpoints := m.groupManager.FilterEndpointsByActiveGroups(snapshot)

	// Then find by name
	for _, endpoint := range activeEndpoints {
		if endpoint.Config.Name == name {
			return endpoint
		}
	}
	return nil
}

// GetEndpointByNameAny returns an endpoint by name from all endpoints (ignoring group status)
func (m *Manager) GetEndpointByNameAny(name string) *Endpoint {
	m.endpointsMu.RLock()
	defer m.endpointsMu.RUnlock()

	for _, endpoint := range m.endpoints {
		if endpoint.Config.Name == name {
			return endpoint
		}
	}
	return nil
}

// GetAllEndpoints returns all endpoints (deprecated: use GetEndpoints instead)
func (m *Manager) GetAllEndpoints() []*Endpoint {
	m.endpointsMu.RLock()
	defer m.endpointsMu.RUnlock()

	result := make([]*Endpoint, len(m.endpoints))
	copy(result, m.endpoints)
	return result
}

// GetEndpoints returns all endpoints for Web interface
func (m *Manager) GetEndpoints() []*Endpoint {
	m.endpointsMu.RLock()
	defer m.endpointsMu.RUnlock()

	result := make([]*Endpoint, len(m.endpoints))
	copy(result, m.endpoints)
	return result
}

// GetEndpointStatus returns the status of an endpoint by name
func (m *Manager) GetEndpointStatus(name string) EndpointStatus {
	m.endpointsMu.RLock()
	defer m.endpointsMu.RUnlock()

	for _, ep := range m.endpoints {
		if ep.Config.Name == name {
			ep.mutex.RLock()
			status := ep.Status
			ep.mutex.RUnlock()
			return status
		}
	}
	return EndpointStatus{}
}

// GetEndpointCount 返回当前端点数量（v5.0+ 新增）
func (m *Manager) GetEndpointCount() int {
	m.endpointsMu.RLock()
	defer m.endpointsMu.RUnlock()
	return len(m.endpoints)
}
