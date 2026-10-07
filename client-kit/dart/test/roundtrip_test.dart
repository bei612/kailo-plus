// 四侧 round-trip 的 Dart 一侧（ADR-03）。
//
// 反序列化再序列化必须与样例语义相等。它验证生成类型没有丢字段、
// 没有把可选当必填、没有把缺省字段写成 null。
import 'dart:convert';
import 'dart:io';

import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:test/test.dart';

void main() {
  test('Project preference preserves original coordinate and shared CAS', () {
    final sample =
        jsonDecode(
              File(
                '../../contracts/samples/project-preference.sample.json',
              ).readAsStringSync(),
            )
            as List;
    expect(
      sample
          .map((row) => ProjectPreferenceRequest.fromJson(row).toJson())
          .toList(),
      sample,
    );
  });

  test(
    'Projects publication preserves native metadata and exact head reference',
    () {
      final sample =
          jsonDecode(
                File(
                  '../../contracts/samples/projects-publication.sample.json',
                ).readAsStringSync(),
              )
              as List;
      expect(
        sample
            .map((row) => ProjectsPublishRequest.fromJson(row).toJson())
            .toList(),
        sample,
      );
    },
  );
  test('Inbox Agent identity and author query preserve legacy absence', () {
    for (final present in [true, false]) {
      final sample = jsonDecode(
        File(
          '../../contracts/samples/inbox-agent.sample.json',
        ).readAsStringSync(),
      );
      if (!present) {
        sample['query'].remove('agentInstallationId');
        sample['installation'].remove('agentPubkey');
      }
      expect(
        WebMessageQuery.fromJson(sample['query']).toJson(),
        sample['query'],
      );
      expect(
        AgentInstallationView.fromJson(sample['installation']).toJson(),
        sample['installation'],
      );
    }
  });
  test('custom emoji preserves removal and empty signed set view', () {
    final sample = jsonDecode(
      File(
        '../../contracts/samples/web-custom-emoji.sample.json',
      ).readAsStringSync(),
    );
    for (final key in ['add', 'remove']) {
      expect(
        WebCustomEmojiMutation.fromJson(sample[key]).toJson(),
        sample[key],
      );
    }
    expect(
      WebCustomEmojiView.fromJson(sample['view']).toJson(),
      sample['view'],
    );
  });
  test('AgentVersionView preserves exact avatar map and legacy absence', () {
    final sample =
        jsonDecode(
              File(
                '../../contracts/samples/agent-version-view.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    for (final include in [true, false]) {
      if (!include) sample.remove('avatarMediaPaths');
      final typed = AgentVersionView.fromJson(sample);
      expect(typed.avatarMediaPaths != null, include);
      expect(jsonDecode(jsonEncode(typed.toJson())), sample);
    }
  });
  test(
    'native human action preserves controlled trust and nonterminal references',
    () {
      final sample = jsonDecode(
        File(
          '../../contracts/samples/native-human-action.sample.json',
        ).readAsStringSync(),
      );
      expect(
        ApplicationNativeHumanIdentity.fromJson(sample['trust']).toJson(),
        sample['trust'],
      );
      expect(
        NativeHumanActionRequest.fromJson(sample['request']).toJson(),
        sample['request'],
      );
      expect(
        NativeHumanActionResult.fromJson(sample['result']).toJson(),
        sample['result'],
      );
    },
  );
  test(
    'native sync grant preserves own admission and read-only terminal outcomes',
    () {
      final request = jsonDecode(
        File(
          '../../contracts/samples/adapter-native-read-grant-request.sample.json',
        ).readAsStringSync(),
      );
      expect(AdapterReadGrantRequest.fromJson(request).toJson(), request);
      final responses =
          jsonDecode(
                File(
                  '../../contracts/samples/adapter-native-read-grant-responses.sample.json',
                ).readAsStringSync(),
              )
              as List<dynamic>;
      expect(
        responses
            .map((v) => AdapterReadGrantResponse.fromJson(v).toJson())
            .toList(),
        responses,
      );
      final listing = jsonDecode(
        File(
          '../../contracts/samples/file-storage-list-output.sample.json',
        ).readAsStringSync(),
      );
      expect(FileStorageListOutput.fromJson(listing).toJson(), listing);
    },
  );
  test('automation topic step preserves explicit empty topic', () {
    final sample = jsonDecode(
      File(
        '../../contracts/samples/automation-topic-step.sample.json',
      ).readAsStringSync(),
    );
    expect(AutomationStep.fromJson(sample).toJson(), sample);
  });
  test('read receipts preserve native precision roles and quantities', () {
    final sample =
        jsonDecode(
              File(
                '../../contracts/samples/adapter-read-receipts.sample.json',
              ).readAsStringSync(),
            )
            as List<dynamic>;
    expect(
      sample
          .map((value) => AdapterReadReceipt.fromJson(value).toJson())
          .toList(),
      sample,
    );
  });
  test('automation reaction step preserves original emoji', () {
    final sample = jsonDecode(
      File(
        '../../contracts/samples/automation-reaction-step.sample.json',
      ).readAsStringSync(),
    );
    expect(AutomationStep.fromJson(sample).toJson(), sample);
  });
  test(
    'application read resources preserve metadata and legacy entry absence',
    () {
      final sample =
          jsonDecode(
                File(
                  '../../contracts/samples/application-read-resources.sample.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      expect(
        ApplicationReadResourcePage.fromJson(sample['page']).toJson(),
        sample['page'],
      );
      for (final available in [true, false, null]) {
        final value = Map<String, dynamic>.from(sample['binding']);
        if (available == null) {
          value.remove('hasReadReceiver');
        } else {
          value['hasReadReceiver'] = available;
        }
        expect(ApplicationBindingView.fromJson(value).toJson(), value);
      }
    },
  );
  test('service read permission preserves receiver and legacy absence', () {
    final sample =
        jsonDecode(
              File(
                '../../contracts/samples/resource-service-read-permission.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    for (final service in [true, false]) {
      final value = Map<String, dynamic>.from(sample);
      if (!service) value.remove('receiverResource');
      expect(ActionCommand.fromJson(value).toJson(), value);
    }
  });
  test(
    'automation approval step preserves policy and immutable view reference',
    () {
      final sample =
          jsonDecode(
                File(
                  '../../contracts/samples/automation-approval-step.sample.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      expect(AutomationStep.fromJson(sample['step']).toJson(), sample['step']);
      expect(
        AutomationApprovalStepView.fromJson(sample['view']).toJson(),
        sample['view'],
      );
    },
  );
  test('receiver read grant preserves distinct source and receiver provenance', () {
    final request =
        jsonDecode(
              File(
                '../../contracts/samples/adapter-read-grant-request.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final response =
        jsonDecode(
              File(
                '../../contracts/samples/adapter-read-grant-response.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    expect(AdapterReadGrantRequest.fromJson(request).toJson(), request);
    expect(AdapterReadGrantResponse.fromJson(response).toJson(), response);
  });
  test('conformance identity preserves isolated authorization and execution', () {
    final sample =
        jsonDecode(
              File(
                '../../contracts/samples/component-conformance-identity.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    expect(ComponentConformanceIdentity.fromJson(sample).toJson(), sample);
  });
  test('member removal permissions preserve true false and legacy absence', () {
    final sample =
        jsonDecode(
              File(
                '../../contracts/samples/member-action-availability.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    for (final permission in [true, false, null]) {
      final value = jsonDecode(jsonEncode(sample)) as Map<String, dynamic>;
      final row = (value['members'] as List).first as Map<String, dynamic>;
      for (final key in ['canRemoveFromWorkspace', 'canRemoveFromTenant']) {
        if (permission == null) {
          row.remove(key);
        } else {
          row[key] = permission;
        }
      }
      expect(RoleMemberPage.fromJson(value).toJson(), value);
    }
  });
  test('Installation upgrade permission keeps false and legacy absence', () {
    final sample =
        jsonDecode(
              File(
                '../../contracts/samples/agent-installation-upgrade.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    for (final permission in [true, false, null]) {
      final value = Map<String, dynamic>.from(sample);
      if (permission == null) {
        value.remove('canUpgrade');
      } else {
        value['canUpgrade'] = permission;
      }
      expect(AgentInstallationView.fromJson(value).toJson(), value);
    }
  });
  test('Projects query preserves scoped coordinates and optional window', () {
    final sample =
        jsonDecode(
              File(
                '../../contracts/samples/projects-query.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    for (final value in [
      sample,
      <String, dynamic>{'view': 'PROJECTS'},
    ]) {
      expect(ProjectsQueryRequest.fromJson(value).toJson(), value);
    }
  });
  test('seed and human registration keep separate evidence', () {
    final value =
        jsonDecode(
              File(
                '../../contracts/samples/capability-seed-page.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    for (final seeded in [true, false]) {
      if (!seeded) {
        final row = (value['contracts'] as List).first as Map<String, dynamic>;
        row['registeredByActionExecutionId'] = row.remove(
          'bootstrapActionExecutionId',
        );
      }
      expect(CapabilityContractPage.fromJson(value).toJson(), value);
    }
  });
  test('component conformance keeps native references and legacy absence', () {
    final value =
        jsonDecode(
              File(
                '../../contracts/samples/component-peer-conformance.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    for (final include in [true, false]) {
      if (!include) value.remove('nativeCredentials');
      expect(ComponentProtocolPeerEnvironment.fromJson(value).toJson(), value);
    }
  });
  test('Pulse requests and optional native limit preserve original fields', () {
    final publish =
        jsonDecode(
              File(
                '../../contracts/samples/pulse-publish.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    expect(PulsePublishRequest.fromJson(publish).toJson(), publish);
    final query =
        jsonDecode(
              File(
                '../../contracts/samples/pulse-query.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    expect(PulseQueryRequest.fromJson(query).toJson(), query);
    for (final limit in <int?>[null, 100]) {
      final value = <String, dynamic>{
        'relayUrl': 'wss://relay.example',
        'communityHost': 'relay.example',
        if (limit != null) 'relayQueryLimit': limit,
      };
      expect(NativeCommunityFacts.fromJson(value).toJson(), value);
    }
  });
  test('workspace membership keeps true false and absence distinct', () {
    for (final member in <bool?>[null, false, true]) {
      final value = <String, dynamic>{
        'id': 'scope',
        'name': 'Scope',
        'slug': 'scope',
        if (member != null) 'isMember': member,
      };
      final typed = WorkspaceView.fromJson(value);
      expect(typed.isMember, member);
      expect(typed.toJson(), value);
    }
  });
  test(
    'conversation references roundtrip without inventing optional cursor',
    () {
      final readers = <String, dynamic Function(Map<String, dynamic>)>{
        'delegated-action-metadata.sample.json': (value) =>
            DelegatedActionMetadataV1.fromJson(value).toJson(),
        'conversation-preference.sample.json': (value) =>
            ConversationPreferenceRequest.fromJson(value).toJson(),
        'workspace-channel-create.sample.json': (value) =>
            ActionCommand.fromJson(value).toJson(),
        'workspace-public-create.sample.json': (value) =>
            ActionCommand.fromJson(value).toJson(),
        'workspace-join.sample.json': (value) =>
            ActionCommand.fromJson(value).toJson(),
        'discoverable-workspaces.sample.json': (value) =>
            DiscoverableWorkspacePage.fromJson(value).toJson(),
        'conversation-open.sample.json': (value) =>
            ActionCommand.fromJson(value).toJson(),
        'conversation-participants.sample.json': (value) =>
            ConversationParticipantPage.fromJson(value).toJson(),
        'conversation-page.sample.json': (value) =>
            ConversationPage.fromJson(value).toJson(),
        'conversation-projection.sample.json': (value) =>
            ConversationProjectionRequest.fromJson(value).toJson(),
        'web-forum-post.sample.json': (value) =>
            WebPublishMessageRequest.fromJson(value).toJson(),
        'web-forum-comment.sample.json': (value) =>
            WebPublishMessageRequest.fromJson(value).toJson(),
        'web-forum-query.sample.json': (value) =>
            WebMessageQuery.fromJson(value).toJson(),
        'web-message-query-legacy.sample.json': (value) =>
            WebMessageQuery.fromJson(value).toJson(),
        'web-message-cursor.sample.json': (value) =>
            WebMessageCursor.fromJson(value).toJson(),
        'web-forum-channel.sample.json': (value) =>
            WebChannelView.fromJson(value).toJson(),
      };
      for (final entry in readers.entries) {
        final original =
            jsonDecode(
                  File(
                    '../../contracts/samples/${entry.key}',
                  ).readAsStringSync(),
                )
                as Map<String, dynamic>;
        expect(jsonDecode(jsonEncode(entry.value(original))), equals(original));
      }
    },
  );
  test('application model preserves route references and absent correlation', () {
    final admission =
        jsonDecode(
              File(
                '../../contracts/samples/application-model-admission.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    expect(
      jsonDecode(
        jsonEncode(ApplicationModelAdmission.fromJson(admission).toJson()),
      ),
      equals(admission),
    );
    final config =
        jsonDecode(
              File(
                '../../contracts/samples/application-model-config.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    expect(
      jsonDecode(
        jsonEncode(ApplicationModelGatewayConfig.fromJson(config).toJson()),
      ),
      equals(config),
    );
  });
  test(
    'native credentials preserve binding generation and exact references',
    () {
      for (final sample in [
        'application-peer-credentials.sample.json',
        'application-model-delivery.sample.json',
      ]) {
        final original =
            jsonDecode(
                  File('../../contracts/samples/$sample').readAsStringSync(),
                )
                as Map<String, dynamic>;
        final typed = ApplicationAdapterDirectory.fromJson(original);
        expect(jsonDecode(jsonEncode(typed.toJson())), equals(original));
      }
    },
  );
  test('resource reference preserves evidence and original workflow', () {
    final original =
        jsonDecode(
              File(
                '../../contracts/samples/resource-create.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    expect(
      jsonDecode(jsonEncode(ActionCommand.fromJson(original).toJson())),
      equals(original),
    );
    final advance =
        jsonDecode(
              File(
                '../../contracts/samples/resource-provision.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    expect(
      jsonDecode(
        jsonEncode(ResourceProvisionAdvanceRequest.fromJson(advance).toJson()),
      ),
      equals(advance),
    );
  });
  test('binding observation preserves mappings and optional scope', () {
    final original =
        jsonDecode(
              File(
                '../../contracts/samples/application-binding-observations.sample.json',
              ).readAsStringSync(),
            )
            as List<dynamic>;
    final typed = original.map(
      (row) => AdapterBindingObservation.fromJson(row as Map<String, dynamic>),
    );
    expect(
      jsonDecode(jsonEncode(typed.map((row) => row.toJson()).toList())),
      equals(original),
    );
  });
  test('execution reference does not invent an unknown native ID', () {
    final original =
        jsonDecode(
              File(
                '../../contracts/samples/adapter-execution-references.sample.json',
              ).readAsStringSync(),
            )
            as List<dynamic>;
    final typed = original.map(
      (row) => AdapterExecutionReference.fromJson(row as Map<String, dynamic>),
    );
    expect(
      jsonDecode(jsonEncode(typed.map((row) => row.toJson()).toList())),
      equals(original),
    );
  });
  test('native page preserves binding generation and exact origins', () {
    final original =
        jsonDecode(
              File(
                '../../contracts/samples/application-native-page.sample.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final typed = ApplicationNativePage.fromJson(original);
    expect(jsonDecode(jsonEncode(typed.toJson())), equals(original));
  });
  test('component observations preserve references, UNKNOWN and absence', () {
    final original =
        jsonDecode(
              File(
                '../../contracts/samples/component-conformance-observations.sample.json',
              ).readAsStringSync(),
            )
            as List<dynamic>;
    final typed = original.map(
      (step) => ComponentConformanceStepObservation.fromJson(
        step as Map<String, dynamic>,
      ),
    );
    expect(
      jsonDecode(jsonEncode(typed.map((step) => step.toJson()).toList())),
      equals(original),
    );
  });
  test(
    'automation cron round-trip preserves exact spec and legacy interval',
    () {
      final original =
          jsonDecode(
                File(
                  '../../contracts/samples/automation-cron.sample.json',
                ).readAsStringSync(),
              )
              as List<dynamic>;
      final typed = original
          .map(
            (row) =>
                AutomationVersionContent.fromJson(row as Map<String, dynamic>),
          )
          .toList();
      expect(
        jsonDecode(jsonEncode(typed.map((row) => row.toJson()).toList())),
        equals(original),
      );
    },
  );
  test(
    'automation POST_MESSAGE round-trip preserves action and native schedule',
    () {
      final original = jsonDecode(
        File(
          '../../contracts/samples/automation-post-message.sample.json',
        ).readAsStringSync(),
      );
      final typed = AutomationVersionContent.fromJson(
        original as Map<String, dynamic>,
      );
      expect(jsonDecode(jsonEncode(typed.toJson())), equals(original));
    },
  );
  test('ordered automation steps preserve IDs and duration', () {
    for (final name in [
      'automation-steps.sample.json',
      'automation-message-sequence.sample.json',
    ]) {
      final original = jsonDecode(
        File('../../contracts/samples/$name').readAsStringSync(),
      );
      final typed = AutomationVersionContent.fromJson(
        original as Map<String, dynamic>,
      );
      expect(typed.action, isNull);
      expect(jsonDecode(jsonEncode(typed.toJson())), equals(original));
    }
  });
  test(
    'component release approval preserves deployment subject and NONE host API',
    () {
      final original =
          jsonDecode(
                File(
                  '../../contracts/samples/component-release-approval.sample.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      final typed = ComponentReleaseApprovalReport.fromJson(original);
      // The generated date-time consumer preserves the instant, not the
      // optional fractional-second spelling of RFC 3339.
      final workerBuild = original['workerBuild'] as Map<String, dynamic>;
      workerBuild['reportedAt'] = DateTime.parse(
        workerBuild['reportedAt'] as String,
      ).toIso8601String();
      expect(jsonDecode(jsonEncode(typed.toJson())), equals(original));
    },
  );
  test('automation run pages preserve UNKNOWN and empty page', () {
    final original =
        jsonDecode(
              File(
                '../../contracts/samples/automation-run-pages.sample.json',
              ).readAsStringSync(),
            )
            as List<dynamic>;
    final typed = original
        .map((page) => AutomationRunPage.fromJson(page as Map<String, dynamic>))
        .toList();
    expect(
      jsonDecode(jsonEncode(typed.map((page) => page.toJson()).toList())),
      equals(original),
    );
  });
  test('manual run capability and deleted definition preserve wire fields', () {
    final original =
        jsonDecode(
              File(
                '../../contracts/samples/automation-manual-delete.sample.json',
              ).readAsStringSync(),
            )
            as List<dynamic>;
    final typed = original
        .map(
          (row) => AutomationDetailView.fromJson(row as Map<String, dynamic>),
        )
        .toList();
    expect(typed[0].canRun, isNull);
    expect(typed[1].canRun, isTrue);
    expect(typed[2].automation.state, AutomationState.DELETED);
    expect(
      jsonDecode(jsonEncode(typed.map((row) => row.toJson()).toList())),
      equals(original),
    );
  });
  test('capability vectors round-trip preserves steps and encoded values', () {
    final original = jsonDecode(
      File(
        '../../contracts/samples/capability-conformance-vectors.sample.json',
      ).readAsStringSync(),
    );
    final typed = CapabilityConformanceVectors.fromJson(
      original as Map<String, dynamic>,
    );
    expect(jsonDecode(jsonEncode(typed.toJson())), equals(original));
  });
  for (final sample in [
    'web-publish-mention.sample.json',
    'web-publish-content-only.sample.json',
    'web-message-edit.sample.json',
    'web-message-delete.sample.json',
  ]) {
    test('WebPublishMessageRequest round-trip $sample', () {
      final original = jsonDecode(
        File('../../contracts/samples/$sample').readAsStringSync(),
      );
      final typed = WebPublishMessageRequest.fromJson(
        original as Map<String, dynamic>,
      );
      expect(jsonDecode(jsonEncode(typed.toJson())), equals(original));
    });
  }
  test('canary round-trip 保留每个字段', () {
    // 相对包根定位样例，不依赖调用时的工作目录
    final file = File('../../contracts/samples/canary.sample.json');
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
