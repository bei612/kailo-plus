import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:client_kit/shared/platform/platform_text.dart';
import 'package:client_kit/shared/platform/reason_text.dart';
import '../../shared/platform/platform_views.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/app_list.dart';
import '../../shared/widgets/app_list_card.dart';
import 'platform_async_view.dart';

// 任务与审批的只读视图（apps/02 §4：Mobile 为受权只读视图；REQ-21）。
//
// 这里没有撤回、批准或拒绝：Mobile 不渲染这些控制的入口，只在详情里说明去
// Web/Desktop 完成。状态的读法与 Web/Desktop 共用包（
// `client-kit/ts/platform/src/governance.ts` 的 taskPhase）逐条相同：结果不明与投影
// 落后一律显示「等待对账」，不说成功也不说失败；只有 Workflow 终态 COMPLETED 才是
// 完成，没有 Workflow 的同步动作以 DISPATCHED 为终态。

/// 一项任务此刻的读法。
String platformTaskPhase(TaskView task, {String? locale}) {
  switch (task.observation) {
    case ReasonCode.EXTERNAL_RESULT_UNKNOWN:
      return platformText(
        PlatformMessageKey.tasksStatusUnknown,
        locale: locale,
      );
    case null:
      break;
    default:
      return platformText(
        PlatformMessageKey.tasksStatusDelayed,
        locale: locale,
      );
  }
  switch (task.gateState) {
    case ActionGateState.EVALUATING:
      return platformText(
        PlatformMessageKey.tasksStatusEvaluating,
        locale: locale,
      );
    case ActionGateState.WAITING:
      return platformText(
        PlatformMessageKey.tasksStatusWaitingApproval,
        locale: locale,
      );
    case ActionGateState.DENIED:
      return platformText(PlatformMessageKey.tasksStatusDenied, locale: locale);
    case ActionGateState.REVOKED:
      return platformText(
        PlatformMessageKey.tasksStatusRevoked,
        locale: locale,
      );
    case ActionGateState.EXPIRED:
      return platformText(
        PlatformMessageKey.tasksStatusExpired,
        locale: locale,
      );
    case ActionGateState.ALLOWED:
      break;
  }
  switch (task.dispatchState) {
    case ActionDispatchState.NOT_DISPATCHED:
      return platformText(
        PlatformMessageKey.tasksStatusNotStarted,
        locale: locale,
      );
    case ActionDispatchState.ABORTED:
      return platformText(
        PlatformMessageKey.tasksStatusAborted,
        locale: locale,
      );
    case ActionDispatchState.UNKNOWN:
      return platformText(
        PlatformMessageKey.tasksStatusUnknown,
        locale: locale,
      );
    case ActionDispatchState.DISPATCHED:
      break;
  }
  if (task.workflowId == null) {
    return platformText(PlatformMessageKey.tasksStatusApplied, locale: locale);
  }
  return switch (task.taskStatus) {
    null => platformText(PlatformMessageKey.tasksStatusStarted, locale: locale),
    TaskStatus.RUNNING => platformText(
      PlatformMessageKey.tasksStatusRunning,
      locale: locale,
    ),
    TaskStatus.COMPLETED => platformText(
      PlatformMessageKey.tasksStatusCompleted,
      locale: locale,
    ),
    TaskStatus.FAILED => platformText(
      PlatformMessageKey.tasksStatusFailed,
      locale: locale,
    ),
    TaskStatus.CANCELED => platformText(
      PlatformMessageKey.tasksStatusCanceled,
      locale: locale,
    ),
    TaskStatus.TERMINATED => platformText(
      PlatformMessageKey.tasksStatusTerminated,
      locale: locale,
    ),
    TaskStatus.TIMED_OUT => platformText(
      PlatformMessageKey.tasksStatusTimedOut,
      locale: locale,
    ),
  };
}

String _approvalPhase(ApprovalView approval, String locale) =>
    switch (approval.observation) {
      null => platformApprovalStatusText(approval.status, locale: locale),
      ReasonCode.EXTERNAL_RESULT_UNKNOWN => platformText(
        PlatformMessageKey.tasksStatusUnknown,
        locale: locale,
      ),
      _ => platformText(PlatformMessageKey.tasksStatusDelayed, locale: locale),
    };

String _reason(ReasonCode code, String locale) => platformText(
  PlatformMessageKey.platformReasonWithCode,
  locale: locale,
  variables: {
    'text': platformReasonText(code, locale: locale),
    'code': platformReasonCode(code),
  },
);

/// 本人发起的受治理动作。
class PlatformTasksPage extends ConsumerWidget {
  const PlatformTasksPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          platformText(PlatformMessageKey.tasksMyTitle, locale: locale),
        ),
      ),
      body: PlatformAsyncView(
        value: ref.watch(platformTasksProvider),
        onRetry: () => ref.invalidate(platformTasksProvider),
        builder: (context, tasks) => tasks.isEmpty
            ? Center(
                child: Text(
                  platformText(PlatformMessageKey.tasksNone, locale: locale),
                ),
              )
            : RefreshIndicator(
                onRefresh: () => ref.refresh(platformTasksProvider.future),
                child: ListView(
                  children: [
                    AppListCard(
                      children: [
                        for (final task in tasks)
                          AppListRow(
                            key: ValueKey(
                              'platform-task-${task.actionExecutionId}',
                            ),
                            title: task.actionKey,
                            subtitle:
                                '${platformTaskPhase(task, locale: locale)}\n${platformRelativeTime(task.createdAt, locale: locale)}',
                            subtitleMaxLines: 3,
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) => PlatformTaskDetailPage(
                                  actionExecutionId: task.actionExecutionId,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

class PlatformTaskDetailPage extends ConsumerWidget {
  const PlatformTaskDetailPage({super.key, required this.actionExecutionId});

  final String actionExecutionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final provider = platformTaskProvider(actionExecutionId);
    return Scaffold(
      appBar: AppBar(
        title: Text(
          platformText(PlatformMessageKey.tasksTitle, locale: locale),
        ),
      ),
      body: PlatformAsyncView(
        value: ref.watch(provider),
        onRetry: () => ref.invalidate(provider),
        builder: (context, task) => ListView(
          children: [
            AppListCard(
              label: task.actionKey,
              children: [
                _Fact(
                  platformText(
                    PlatformMessageKey.platformState,
                    locale: locale,
                  ),
                  platformTaskPhase(task, locale: locale),
                  id: 'platform-task-state',
                ),
                if (task.observation case final code?)
                  _Fact(
                    platformText(
                      PlatformMessageKey.tasksReason,
                      locale: locale,
                    ),
                    _reason(code, locale),
                  ),
                if (task.reason case final code?)
                  _Fact(
                    platformText(
                      PlatformMessageKey.tasksReason,
                      locale: locale,
                    ),
                    _reason(code, locale),
                  ),
                if (task.waitingReason case final waiting?)
                  _Fact(
                    platformText(
                      PlatformMessageKey.tasksWaitingReason,
                      locale: locale,
                    ),
                    waiting,
                  ),
                _Fact(
                  platformText(PlatformMessageKey.tasksCreated, locale: locale),
                  platformAbsoluteTime(task.createdAt, locale: locale),
                ),
                _Fact(
                  platformText(
                    PlatformMessageKey.tasksOperation,
                    locale: locale,
                  ),
                  task.operationId,
                ),
                _Fact(
                  platformText(
                    PlatformMessageKey.tasksExecution,
                    locale: locale,
                  ),
                  task.actionExecutionId,
                ),
                _Fact(
                  platformText(PlatformMessageKey.tasksTarget, locale: locale),
                  task.targetId,
                ),
                if (task.workflowId case final workflow?)
                  _Fact(
                    platformText(
                      PlatformMessageKey.tasksWorkflow,
                      locale: locale,
                    ),
                    workflow,
                  ),
              ],
            ),
            if (task.approvalWorkflowId case final workflowId?)
              _ApprovalFacts(workflowId: workflowId),
          ],
        ),
      ),
    );
  }
}

/// 待我审批。
class PlatformApprovalsPage extends ConsumerWidget {
  const PlatformApprovalsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          platformText(
            PlatformMessageKey.approvalsPendingTitle,
            locale: locale,
          ),
        ),
      ),
      body: PlatformAsyncView(
        value: ref.watch(platformPendingApprovalsProvider),
        onRetry: () => ref.invalidate(platformPendingApprovalsProvider),
        builder: (context, approvals) => approvals.isEmpty
            ? Center(
                child: Text(
                  platformText(
                    PlatformMessageKey.approvalsNone,
                    locale: locale,
                  ),
                ),
              )
            : RefreshIndicator(
                onRefresh: () =>
                    ref.refresh(platformPendingApprovalsProvider.future),
                child: ListView(
                  children: [
                    _Explain(
                      platformText(
                        PlatformMessageKey.approvalsMobileReadOnly,
                        locale: locale,
                      ),
                    ),
                    AppListCard(
                      children: [
                        for (final approval in approvals)
                          AppListRow(
                            key: ValueKey(
                              'platform-approval-${approval.workflowId}',
                            ),
                            title: approval.actionKey,
                            subtitle:
                                '${_approvalPhase(approval, locale)}\n${platformText(
                                  PlatformMessageKey.approvalsExpiresAt,
                                  locale: locale,
                                  variables: {'time': platformRelativeTime(approval.expiresAt, locale: locale)},
                                )}',
                            subtitleMaxLines: 3,
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) => Scaffold(
                                  appBar: AppBar(
                                    title: Text(
                                      platformText(
                                        PlatformMessageKey.tasksApproval,
                                        locale: locale,
                                      ),
                                    ),
                                  ),
                                  body: ListView(
                                    children: [
                                      _ApprovalFacts(
                                        workflowId: approval.workflowId,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

/// 一项审批的事实（发起者、已决定者或此刻合格的审批者可见，由 BFF 判定）。
class _ApprovalFacts extends ConsumerWidget {
  const _ApprovalFacts({required this.workflowId});

  final String workflowId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final provider = platformApprovalProvider(workflowId);
    return PlatformAsyncView(
      value: ref.watch(provider),
      onRetry: () => ref.invalidate(provider),
      builder: (context, approval) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AppListCard(
            label: platformText(
              PlatformMessageKey.tasksApproval,
              locale: locale,
            ),
            children: [
              _Fact(
                platformText(
                  PlatformMessageKey.approvalsStatus,
                  locale: locale,
                ),
                _approvalPhase(approval, locale),
                id: 'platform-approval-state',
              ),
              if (approval.observation case final code?)
                _Fact(
                  platformText(PlatformMessageKey.tasksReason, locale: locale),
                  _reason(code, locale),
                ),
              if (approval.reason case final code?)
                _Fact(
                  platformText(PlatformMessageKey.tasksReason, locale: locale),
                  _reason(code, locale),
                ),
              _Fact(
                platformText(
                  PlatformMessageKey.approvalsExpires,
                  locale: locale,
                ),
                platformAbsoluteTime(approval.expiresAt, locale: locale),
              ),
              _Fact(
                platformText(PlatformMessageKey.tasksTarget, locale: locale),
                '${approval.targetType} ${approval.targetId}',
              ),
              _Fact(
                platformText(
                  PlatformMessageKey.approvalsInitiator,
                  locale: locale,
                ),
                approval.initiatorPrincipalId,
              ),
              _Fact(
                platformText(
                  PlatformMessageKey.approvalsRequirements,
                  locale: locale,
                ),
                approval.roleRequirements
                    .map(
                      (r) => platformText(
                        PlatformMessageKey.approvalsRequirement,
                        locale: locale,
                        variables: {
                          'selector': platformApprovalSelectorText(
                            r.selector,
                            locale: locale,
                          ),
                          'count': r.minDistinct,
                        },
                      ),
                    )
                    .join('; '),
              ),
              _Fact(
                platformText(PlatformMessageKey.tasksWorkflow, locale: locale),
                approval.workflowId,
              ),
            ],
          ),
          AppListCard(
            label: platformText(
              PlatformMessageKey.approvalsDecisions,
              locale: locale,
            ),
            children: [
              if (approval.decisions.isEmpty)
                AppListRow(
                  title: platformText(
                    PlatformMessageKey.approvalsNoDecisions,
                    locale: locale,
                  ),
                )
              else
                for (final d in approval.decisions)
                  AppListRow(
                    title: platformApprovalDecisionText(
                      d.decision,
                      locale: locale,
                    ),
                    subtitle:
                        '${d.approverPrincipalId}\n${platformAbsoluteTime(d.decidedAt, locale: locale)}',
                    subtitleMaxLines: 3,
                  ),
            ],
          ),
          if (approval.status == ApprovalStatus.REQUESTED ||
              approval.status == ApprovalStatus.WAITING)
            _Explain(
              platformText(
                PlatformMessageKey.approvalsMobileReadOnly,
                locale: locale,
              ),
            ),
        ],
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact(this.label, this.value, {this.id});

  final String label;
  final String value;

  /// 测试与无障碍定位用的稳定标识
  final String? id;

  @override
  Widget build(BuildContext context) => AppListRow(
    key: id == null ? null : ValueKey(id),
    title: label,
    subtitle: value,
    subtitleMaxLines: 4,
  );
}

class _Explain extends StatelessWidget {
  const _Explain(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(Grid.gutter),
    child: Text(
      text,
      key: const ValueKey('platform-decide-elsewhere'),
      style: context.textTheme.bodyMedium,
    ),
  );
}
