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
}
