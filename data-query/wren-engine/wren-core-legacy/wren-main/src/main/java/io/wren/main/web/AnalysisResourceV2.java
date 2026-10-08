/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package io.wren.main.web;

import com.google.inject.Inject;
import io.trino.sql.tree.FunctionCall;
import io.trino.sql.tree.FunctionRelation;
import io.trino.sql.tree.Node;
import io.trino.sql.tree.PathRelation;
import io.trino.sql.tree.Query;
import io.trino.sql.tree.Statement;
import io.trino.sql.tree.Table;
import io.wren.base.AnalyzedMDL;
import io.wren.base.CatalogSchemaTableName;
import io.wren.base.SessionContext;
import io.wren.base.WrenMDL;
import io.wren.base.sqlrewrite.QueryDescriptor;
import io.wren.base.sqlrewrite.ViewInfo;
import io.wren.base.sqlrewrite.analyzer.Analysis;
import io.wren.base.sqlrewrite.analyzer.StatementAnalyzer;
import io.wren.base.sqlrewrite.analyzer.decisionpoint.DecisionPointAnalyzer;
import io.wren.main.web.dto.SqlAnalysisInputBatchDto;
import io.wren.main.web.dto.SqlAnalysisInputDtoV2;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.container.AsyncResponse;
import jakarta.ws.rs.container.Suspended;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

import static io.wren.base.sqlrewrite.Utils.parseSql;
import static io.wren.main.web.WrenExceptionMapper.bindAsyncResponse;
import static jakarta.ws.rs.core.MediaType.APPLICATION_JSON;
import static java.nio.charset.StandardCharsets.UTF_8;

@Path("/v2/analysis")
public class AnalysisResourceV2
{
    @Inject
    public AnalysisResourceV2() {}

    @GET
    @Path("/sql")
    @Consumes(APPLICATION_JSON)
    @Produces(APPLICATION_JSON)
    public void getSqlAnalysis(
            SqlAnalysisInputDtoV2 inputDto,
            @Suspended AsyncResponse asyncResponse)
    {
        CompletableFuture
                .supplyAsync(() ->
                        Optional.ofNullable(inputDto.getManifestStr())
                                .orElseThrow(() -> new IllegalArgumentException("Manifest is required")))
                .thenApply(manifestStr -> {
                    try {
                        return WrenMDL.fromJson(new String(Base64.getDecoder().decode(manifestStr), UTF_8));
                    }
                    catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                })
                .thenApply(mdl -> {
                    Statement statement = parseSql(inputDto.getSql());
                    return DecisionPointAnalyzer.analyze(
                            statement,
                            SessionContext.builder().setCatalog(mdl.getCatalog()).setSchema(mdl.getSchema()).build(),
                            mdl).stream().map(AnalysisResource::toQueryAnalysisDto).toList();
                })
                .whenComplete(bindAsyncResponse(asyncResponse));
    }

    @GET
    @Path("/sql/sources")
    @Consumes(APPLICATION_JSON)
    @Produces(APPLICATION_JSON)
    public void getSqlSourceObjects(
            SqlAnalysisInputDtoV2 inputDto,
            @Suspended AsyncResponse asyncResponse)
    {
        // DecisionPoint DTOs are explanatory UI facts, not the complete native
        // source set: use the same analyzer and descriptors as the SQL planner.
        CompletableFuture.supplyAsync(() -> {
            WrenMDL mdl;
            try {
                String manifest = Optional.ofNullable(inputDto.getManifestStr())
                        .orElseThrow(() -> new IllegalArgumentException("Manifest is required"));
                mdl = WrenMDL.fromJson(new String(Base64.getDecoder().decode(manifest), UTF_8));
            }
            catch (IOException e) {
                throw new RuntimeException(e);
            }
            Statement statement = parseSql(inputDto.getSql());
            if (!(statement instanceof Query)) {
                throw new IllegalArgumentException("Query is required");
            }
            SessionContext session = SessionContext.builder()
                    .setCatalog(mdl.getCatalog()).setSchema(mdl.getSchema()).build();
            Analysis analysis = new Analysis(statement);
            StatementAnalyzer.analyze(analysis, statement, session, mdl);
            ArrayDeque<Map.Entry<Node, Analysis>> nodes = new ArrayDeque<>();
            nodes.add(Map.entry(statement, analysis));
            Set<CatalogSchemaTableName> sources = new HashSet<>(analysis.getTables());
            AnalyzedMDL analyzed = new AnalyzedMDL(mdl, null);
            ArrayDeque<String> required = new ArrayDeque<>(analysis.getWrenObjectNames());
            Set<String> expanded = new HashSet<>();
            while (!required.isEmpty()) {
                String name = required.removeFirst();
                if (!expanded.add(name)) {
                    continue;
                }
                QueryDescriptor descriptor = QueryDescriptor.of(name, analyzed, session);
                sources.add(new CatalogSchemaTableName(mdl.getCatalog(), mdl.getSchema(), name));
                if (descriptor instanceof ViewInfo) {
                    // ViewInfo's required objects omit direct native tables.
                    // Reuse its real parsed query, including hidden subqueries.
                    Query viewQuery = descriptor.getQuery();
                    Analysis viewAnalysis = new Analysis(viewQuery);
                    StatementAnalyzer.analyze(viewAnalysis, viewQuery, session, mdl);
                    sources.addAll(viewAnalysis.getTables());
                    nodes.add(Map.entry(viewQuery, viewAnalysis));
                }
                required.addAll(descriptor.getRequiredObjects());
            }
            // The original analyzer intentionally omits native table/path
            // functions from getTables. Scalar functions can also hide
            // provider-specific reads. Do not claim complete source evidence
            // for those nodes without a native authorization fact for them.
            while (!nodes.isEmpty()) {
                Map.Entry<Node, Analysis> current = nodes.removeFirst();
                Node node = current.getKey();
                if (node instanceof FunctionRelation || node instanceof PathRelation || node instanceof FunctionCall ||
                        (node instanceof Table && current.getValue().tryGetScope(node).isEmpty())) {
                    throw new IllegalArgumentException("Native source evidence is unavailable");
                }
                // A parsed table outside the original analyzer's visited
                // scopes (for example an unhandled expression child) cannot
                // disappear from the authorization input as an empty source.
                node.getChildren().forEach(child -> nodes.add(Map.entry(child, current.getValue())));
            }
            return sources.stream().sorted(Comparator.comparing(CatalogSchemaTableName::toString)).toList();
        }).whenComplete(bindAsyncResponse(asyncResponse));
    }

    @GET
    @Path("/sqls")
    @Consumes(APPLICATION_JSON)
    @Produces(APPLICATION_JSON)
    public void getSqlAnalysisBatch(
            SqlAnalysisInputBatchDto inputBatchDto,
            @Suspended AsyncResponse asyncResponse)
    {
        CompletableFuture
                .supplyAsync(() ->
                        Optional.ofNullable(inputBatchDto.getManifestStr())
                                .orElseThrow(() -> new IllegalArgumentException("Manifest is required")))
                .thenApply(manifestStr -> {
                    try {
                        return WrenMDL.fromJson(new String(Base64.getDecoder().decode(manifestStr), UTF_8));
                    }
                    catch (IOException e) {
                        throw new RuntimeException(e);
                    }
                })
                .thenApply(mdl ->
                  inputBatchDto.getSqls().stream().map(sql -> {
                      Statement statement = parseSql(sql);
                      return DecisionPointAnalyzer.analyze(
                            statement,
                            SessionContext.builder().setCatalog(mdl.getCatalog()).setSchema(mdl.getSchema()).build(),
                            mdl).stream().map(AnalysisResource::toQueryAnalysisDto).toList();
                  }).toList())
                .whenComplete(bindAsyncResponse(asyncResponse));
    }
}
