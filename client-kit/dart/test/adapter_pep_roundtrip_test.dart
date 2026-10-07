import 'dart:convert';
import 'dart:io';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:test/test.dart';

void main() {
  test('adapter citations preserve typed sources and empty absence', () {
    final sample =
        jsonDecode(
              File(
                '../../contracts/samples/adapter-citations.sample.json',
              ).readAsStringSync(),
            )
            as List;
    expect(
      sample
          .map((row) => AdapterExecutionResponse.fromJson(row).toJson())
          .toList(),
      sample,
    );
  });
  test('adapter PEP preserves native resource and legacy absence', () {
    final sample =
        jsonDecode(
              File(
                '../../contracts/samples/adapter-pep-resource.sample.json',
              ).readAsStringSync(),
            )
            as List;
    expect(
      sample
          .map((row) => AdapterPepCheckResponse.fromJson(row).toJson())
          .toList(),
      sample,
    );
  });
}
