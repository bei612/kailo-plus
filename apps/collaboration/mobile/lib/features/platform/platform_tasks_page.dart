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

// 任务与审批的只读视图（Kailo apps/02 §4：Mobile 为受权只读视图；REQ-21）。
//
// 这里没有撤回、批准或拒绝：Mobile 不渲染这些控制的入口，只在详情里说明去
// Web/Desktop 完成。状态的读法与 Web/Desktop 共用包（Kailo
// `web/packages/platform/src/governance.ts` 的 taskPhase）逐条相同：结果不明与投影
// 落后一律显示「等待对账」，不说成功也不说失败；只有 Workflow 终态 COMPLETED 才是
// 完成，没有 Workflow 的同步动作以 DISPATCHED 为终态。

/// 一项任务此刻的读法。
String kailoTaskPhase(TaskView task, {String? locale}) {
  switch (task.observation) {
    case ReasonCode.EXTERNAL_RESULT_UNKNOWN:
      return kailoText(KailoMessageKey.tasksStatusUnknown, locale: locale);
    case null:
      break;
    default:
      return kailoText(KailoMessageKey.tasksStatusDelayed, locale: locale);
  }
  switch (task.gateState) {
    case ActionGateState.EVALUATING:
      return kailoText(KailoMessageKey.tasksStatusEvaluating, locale: locale);
    case ActionGateState.WAITING:
      return kailoText(
        KailoMessageKey.tasksStatusWaitingApproval,
        locale: locale,
      );
    case ActionGateState.DENIED:
      return kailoText(KailoMessageKey.tasksStatusDenied, locale: locale);
    case ActionGateState.REVOKED:
      return kailoText(KailoMessageKey.tasksStatusRevoked, locale: locale);
    case ActionGateState.EXPIRED:
      return kailoText(KailoMessageKey.tasksStatusExpired, locale: locale);
    case ActionGateState.ALLOWED:
      break;
  }
  switch (task.dispatchState) {
    case ActionDispatchState.NOT_DISPATCHED:
      return kailoText(KailoMessageKey.tasksStatusNotStarted, locale: locale);
    case ActionDispatchState.ABORTED:
      return kailoText(KailoMessageKey.tasksStatusAborted, locale: locale);
    case ActionDispatchState.UNKNOWN:
      return kailoText(KailoMessageKey.tasksStatusUnknown, locale: locale);
    case ActionDispatchState.DISPATCHED:
      break;
  }
  if (task.workflowId == null) {
    return kailoText(KailoMessageKey.tasksStatusApplied, locale: locale);
  }
  return switch (task.taskStatus) {
    null => kailoText(KailoMessageKey.tasksStatusStarted, locale: locale),
    TaskStatus.RUNNING => kailoText(
      KailoMessageKey.tasksStatusRunning,
      locale: locale,
    ),
    TaskStatus.COMPLETED => kailoText(
      KailoMessageKey.tasksStatusCompleted,
      locale: locale,
    ),
    TaskStatus.FAILED => kailoText(
      KailoMessageKey.tasksStatusFailed,
      locale: locale,
    ),
    TaskStatus.CANCELED => kailoText(
      KailoMessageKey.tasksStatusCanceled,
      locale: locale,
    ),
    TaskStatus.TERMINATED => kailoText(
      KailoMessageKey.tasksStatusTerminated,
      locale: locale,
    ),
    TaskStatus.TIMED_OUT => kailoText(
      KailoMessageKey.tasksStatusTimedOut,
      locale: locale,
    ),
  };
}

String _approvalPhase(ApprovalView approval, String locale) =>
    switch (approval.observation) {
      null => kailoApprovalStatusText(approval.status, locale: locale),
      ReasonCode.EXTERNAL_RESULT_UNKNOWN => kailoText(
        KailoMessageKey.tasksStatusUnknown,
        locale: locale,
      ),
      _ => kailoText(KailoMessageKey.tasksStatusDelayed, locale: locale),
    };

String _reason(ReasonCode code, String locale) => kailoText(
  KailoMessageKey.platformReasonWithCode,
  locale: locale,
  variables: {
    'text': kailoReasonText(code, locale: locale),
    'code': kailoReasonCode(code),
  },
);

/// 本人发起的受治理动作。
class KailoTasksPage extends ConsumerWidget {
  const KailoTasksPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Scaffold(
      appBar: AppBar(
        title: Text(kailoText(KailoMessageKey.tasksMyTitle, locale: locale)),
      ),
      body: KailoAsyncView(
        value: ref.watch(kailoTasksProvider),
        onRetry: () => ref.invalidate(kailoTasksProvider),
        builder: (context, tasks) => tasks.isEmpty
            ? Center(
                child: Text(
                  kailoText(KailoMessageKey.tasksNone, locale: locale),
                ),
              )
            : RefreshIndicator(
                onRefresh: () => ref.refresh(kailoTasksProvider.future),
                child: ListView(
                  children: [
                    AppListCard(
                      children: [
                        for (final task in tasks)
                          AppListRow(
                            key: ValueKey(
                              'kailo-task-${task.actionExecutionId}',
                            ),
                            title: task.actionKey,
                            subtitle:
                                '${kailoTaskPhase(task, locale: locale)}\n${kailoRelativeTime(task.createdAt, locale: locale)}',
                            subtitleMaxLines: 3,
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) => KailoTaskDetailPage(
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

class KailoTaskDetailPage extends ConsumerWidget {
  const KailoTaskDetailPage({super.key, required this.actionExecutionId});

  final String actionExecutionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final provider = kailoTaskProvider(actionExecutionId);
    return Scaffold(
      appBar: AppBar(
        title: Text(kailoText(KailoMessageKey.tasksTitle, locale: locale)),
      ),
      body: KailoAsyncView(
        value: ref.watch(provider),
        onRetry: () => ref.invalidate(provider),
        builder: (context, task) => ListView(
          children: [
            AppListCard(
              label: task.actionKey,
              children: [
                _Fact(
                  kailoText(KailoMessageKey.platformState, locale: locale),
                  kailoTaskPhase(task, locale: locale),
                  id: 'kailo-task-state',
                ),
                if (task.observation case final code?)
                  _Fact(
                    kailoText(KailoMessageKey.tasksReason, locale: locale),
                    _reason(code, locale),
                  ),
                if (task.reason case final code?)
                  _Fact(
                    kailoText(KailoMessageKey.tasksReason, locale: locale),
                    _reason(code, locale),
                  ),
                if (task.waitingReason case final waiting?)
                  _Fact(
                    kailoText(
                      KailoMessageKey.tasksWaitingReason,
                      locale: locale,
                    ),
                    waiting,
                  ),
                _Fact(
                  kailoText(KailoMessageKey.tasksCreated, locale: locale),
                  kailoAbsoluteTime(task.createdAt, locale: locale),
                ),
                _Fact(
                  kailoText(KailoMessageKey.tasksOperation, locale: locale),
                  task.operationId,
                ),
                _Fact(
                  kailoText(KailoMessageKey.tasksExecution, locale: locale),
                  task.actionExecutionId,
                ),
                _Fact(
                  kailoText(KailoMessageKey.tasksTarget, locale: locale),
                  task.targetId,
                ),
                if (task.workflowId case final workflow?)
                  _Fact(
                    kailoText(KailoMessageKey.tasksWorkflow, locale: locale),
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
class KailoApprovalsPage extends ConsumerWidget {
  const KailoApprovalsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          kailoText(KailoMessageKey.approvalsPendingTitle, locale: locale),
        ),
      ),
      body: KailoAsyncView(
        value: ref.watch(kailoPendingApprovalsProvider),
        onRetry: () => ref.invalidate(kailoPendingApprovalsProvider),
        builder: (context, approvals) => approvals.isEmpty
            ? Center(
                child: Text(
                  kailoText(KailoMessageKey.approvalsNone, locale: locale),
                ),
              )
            : RefreshIndicator(
                onRefresh: () =>
                    ref.refresh(kailoPendingApprovalsProvider.future),
                child: ListView(
                  children: [
                    _Explain(
                      kailoText(
                        KailoMessageKey.approvalsMobileReadOnly,
                        locale: locale,
                      ),
                    ),
                    AppListCard(
                      children: [
                        for (final approval in approvals)
                          AppListRow(
                            key: ValueKey(
                              'kailo-approval-${approval.workflowId}',
                            ),
                            title: approval.actionKey,
                            subtitle:
                                '${_approvalPhase(approval, locale)}\n${kailoText(
                                  KailoMessageKey.approvalsExpiresAt,
                                  locale: locale,
                                  variables: {'time': kailoRelativeTime(approval.expiresAt, locale: locale)},
                                )}',
                            subtitleMaxLines: 3,
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) => Scaffold(
                                  appBar: AppBar(
                                    title: Text(
                                      kailoText(
                                        KailoMessageKey.tasksApproval,
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
    final provider = kailoApprovalProvider(workflowId);
    return KailoAsyncView(
      value: ref.watch(provider),
      onRetry: () => ref.invalidate(provider),
      builder: (context, approval) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AppListCard(
            label: kailoText(KailoMessageKey.tasksApproval, locale: locale),
            children: [
              _Fact(
                kailoText(KailoMessageKey.approvalsStatus, locale: locale),
                _approvalPhase(approval, locale),
                id: 'kailo-approval-state',
              ),
              if (approval.observation case final code?)
                _Fact(
                  kailoText(KailoMessageKey.tasksReason, locale: locale),
                  _reason(code, locale),
                ),
              if (approval.reason case final code?)
                _Fact(
                  kailoText(KailoMessageKey.tasksReason, locale: locale),
                  _reason(code, locale),
                ),
              _Fact(
                kailoText(KailoMessageKey.approvalsExpires, locale: locale),
                kailoAbsoluteTime(approval.expiresAt, locale: locale),
              ),
              _Fact(
                kailoText(KailoMessageKey.tasksTarget, locale: locale),
                '${approval.targetType} ${approval.targetId}',
              ),
              _Fact(
                kailoText(KailoMessageKey.approvalsInitiator, locale: locale),
                approval.initiatorPrincipalId,
              ),
              _Fact(
                kailoText(
                  KailoMessageKey.approvalsRequirements,
                  locale: locale,
                ),
                approval.roleRequirements
                    .map(
                      (r) => kailoText(
                        KailoMessageKey.approvalsRequirement,
                        locale: locale,
                        variables: {
                          'selector': kailoApprovalSelectorText(
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
                kailoText(KailoMessageKey.tasksWorkflow, locale: locale),
                approval.workflowId,
              ),
            ],
          ),
          AppListCard(
            label: kailoText(
              KailoMessageKey.approvalsDecisions,
              locale: locale,
            ),
            children: [
              if (approval.decisions.isEmpty)
                AppListRow(
                  title: kailoText(
                    KailoMessageKey.approvalsNoDecisions,
                    locale: locale,
                  ),
                )
              else
                for (final d in approval.decisions)
                  AppListRow(
                    title: kailoApprovalDecisionText(
                      d.decision,
                      locale: locale,
                    ),
                    subtitle:
                        '${d.approverPrincipalId}\n${kailoAbsoluteTime(d.decidedAt, locale: locale)}',
                    subtitleMaxLines: 3,
                  ),
            ],
          ),
          if (approval.status == ApprovalStatus.REQUESTED ||
              approval.status == ApprovalStatus.WAITING)
            _Explain(
              kailoText(
                KailoMessageKey.approvalsMobileReadOnly,
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
      key: const ValueKey('kailo-decide-elsewhere'),
      style: context.textTheme.bodyMedium,
    ),
  );
}
