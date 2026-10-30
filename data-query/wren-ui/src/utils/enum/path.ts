export enum Path {
  Home = '/home',
  HomeDashboard = '/home/dashboard',
  Thread = '/home/[id]',
  // DD-138(6) (`07` §4.8.5): modeling, the data source connection (the former
  // onboarding wizard) and the project settings exist only as Kailo admin
  // surfaces (utils/kailoAdminSurface.ts); /modeling and /setup are closed.
  AdminDataSource = '/kailo-admin/data-source',
  AdminModeling = '/kailo-admin/modeling',
  AdminProject = '/kailo-admin/project',
  // DD-169(6)②: the members' read-only data source list.
  DataSources = '/data-sources',
  Knowledge = '/knowledge',
  KnowledgeQuestionSQLPairs = '/knowledge/question-sql-pairs',
  KnowledgeInstructions = '/knowledge/instructions',
  APIManagement = '/api-management',
  APIManagementHistory = '/api-management/history',
}
