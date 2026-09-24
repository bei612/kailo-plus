// 四侧 round-trip 的 Dart 一侧（ADR-03）。
//
// 反序列化再序列化必须与样例语义相等。它验证生成类型没有丢字段、
// 没有把可选当必填、没有把缺省字段写成 null。
import 'dart:convert';
import 'dart:io';

import 'package:kailo_mobile/shared/contracts/contracts.dart';
import 'package:test/test.dart';

void main() {
  test('canary round-trip 保留每个字段', () {
    // 相对包根定位样例，不依赖调用时的工作目录
    final file = File('../contracts/samples/canary.sample.json');
    final raw = file.readAsStringSync();
    final original = jsonDecode(raw);

    final typed = Canary.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    final back = jsonDecode(jsonEncode(typed.toJson()));

    expect(back, equals(original), reason: 'round-trip 后与样例不等');
  });

  // 可选的枚举字段缺省是常态（任务投影没有观察项、门禁没有原因）：解析不得因此
  // 抛错，也不得在回写时补出 null。
  test('可选枚举字段缺省时解析为 null，回写时省略', () {
    final minimal = {
      'operationId': 'op',
      'actionExecutionId': 'ae',
      'actionKey': 'workspace.create',
      'actionVersion': 1,
      'targetId': 't',
      'gateState': 'ALLOWED',
      'dispatchState': 'DISPATCHED',
      'createdAt': '2026-09-24T00:00:00Z',
    };
    final task = TaskView.fromJson(Map<String, dynamic>.from(minimal));
    expect(task.observation, isNull);
    expect(task.taskStatus, isNull);
    expect(jsonDecode(jsonEncode(task.toJson())), equals(minimal));

    final withObservation = {...minimal, 'observation': 'PROJECTION_DELAYED'};
    expect(
      TaskView.fromJson(Map<String, dynamic>.from(withObservation)).observation,
      ReasonCode.PROJECTION_DELAYED,
    );
    // 本端不认识的值不是「没有」：回应不合契约，照旧抛错
    expect(
      () => TaskView.fromJson({...minimal, 'observation': 'NOT_A_CODE'}),
      throwsA(isA<TypeError>()),
    );
  });
}
