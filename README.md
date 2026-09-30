# RAG Agent — 基于聊天 + 检索增强生成的 Agent 工具

一个本地运行的 RAG 问答工具：上传文档（PDF / Word / TXT / 图片），结合**多向量检索 + 向量 RAG + 图谱 RAG 多路召回**，进行带来源引用的流式对话。

## 技术栈

- **后端**：NestJS 10 + TypeScript
- **前端**：React 18 + Vite + Tailwind CSS
- **大模型**：OpenAI 兼容 API（支持 OpenAI / DeepSeek / 火山方舟等，通过 `baseURL` 配置）
- **向量检索**：内置纯 TS 向量库（SQLite 持久化 + 余弦相似度 + BM25 词法召回）
- **知识图谱**：LLM 实体/关系抽取 + SQLite 持久化，用作图 RAG 召回
- **鉴权**：JWT + bcrypt（单 access token）
- **数据库**：Node 内置 `node:sqlite`（零原生依赖，无需 Docker）

## 目录结构

```
webtoon/
├── backend/          # NestJS 后端
│   └── src/
│       ├── auth/         # JWT 登录/注册
│       ├── config/       # LLM 配置（env 默认 + 用户级覆盖）
│       ├── llm/          # chat / stream / embed / 视觉 OCR 封装
│       ├── documents/    # 上传 + 解析(pdf/docx/txt/图片) + 分块
│       ├── vectorstore/  # 向量存储 + BM25 词法召回
│       ├── graph/        # 实体/关系抽取 + 图召回
│       ├── rag/          # 三路召回 + RRF 融合
│       ├── chat/         # SSE 流式问答 + 记忆压缩
│       ├── conversation/ # 会话/消息持久化
│       └── trace/        # 过程追踪（步骤/思考/检索记录）
├── frontend/         # React 前端
└── pnpm-workspace.yaml
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env，填入你的 LLM API Key 和 base URL
```

必备配置项：

| 变量 | 说明 |
|---|---|
| `OPENAI_BASE_URL` | OpenAI 兼容接口地址，如 `https://api.openai.com/v1` |
| `OPENAI_API_KEY` | API Key |
| `LLM_MODEL` | 对话模型，如 `gpt-4o-mini` |
| `EMBEDDING_MODEL` | 向量模型，如 `text-embedding-3-small` |
| `VISION_MODEL` | 图片 OCR 视觉模型 |
| `FAST_MODEL` | 意图识别/重排/建图用的快速模型 |
| `PERSONA` | 角色性格描述（也可在前端设置） |
| `CONTEXT_TOKEN_BUDGET` | 上下文 token 预算（默认 131072 = 128K） |
| `COMPACTION_THRESHOLD` | 记忆压缩触发阈值（默认 0.8） |
| `RECENT_WINDOW` | 压缩后保留的最近原文条数（默认 4） |
| `OCR_MAX_PAGES` | 图片型 PDF OCR 兜底的最大页数（默认 20） |
| `OCR_SCALE` | 图片型 PDF 渲染缩放倍数（默认 1.5） |
| `OCR_MAX_TOKENS` | 视觉 OCR 单页最大输出 token（默认 2000） |
| `WORKER_MAX_HEAP` | 文档解析子进程堆上限，单位 MB（默认 1024） |
| `JWT_SECRET` | JWT 密钥（务必修改） |

> 也可以在登录后通过前端的「设置」页面动态修改 LLM 配置（用户级覆盖，含 API Key）。

### 3. 启动

```bash
# 同时启动后端(3000)和前端(5173)
pnpm dev
```

访问 http://localhost:5173 ，注册账号后即可使用。

## 功能

- **文档管理**：上传/删除 PDF、Word、TXT、图片；自动解析 → 分块 → 向量化 → 建图谱（图片型/扫描 PDF 自动走视觉模型 OCR 兜底）。解析在独立子进程运行并限制堆内存，单文档 OOM 不会拖垮 API 服务。
- **多向量**：细粒度 chunk 向量 + 文档摘要（parent）向量
- **多路召回**：
  1. 向量 RAG（稠密相似度）
  2. 词法召回（BM25）
  3. 图谱 RAG（实体抽取 → 关系遍历 → 子图召回）
- **召回融合**：Reciprocal Rank Fusion (RRF) + LLM 重排
- **意图识别**：判断本轮是否需检索，无文档/闲聊直接纯聊天
- **角色性格（Persona）**：多预设（默认/专业学者/幽默伙伴）+ 自定义
- **会话管理**：多会话持久化（SQLite），切换/新建/删除，历史可回看
- **记忆压缩**：全量优先，达 token 阈值时把更早对话压成摘要（保留约束/偏好 + 最近 N 条原文滑动窗口）
- **过程追踪**：记录意图识别/召回/重排/思考每一步，SSE 实时展示 + 持久化回看
- **Token 统计**：按会话汇总 prompt/completion tokens
- **流式对话**：SSE 流式输出 + 引用来源高亮 + 停止按钮

## API 一览

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/auth/register` | 否 | 注册 |
| POST | `/api/auth/login` | 否 | 登录，返回 JWT |
| POST | `/api/documents/upload` | 是 | 上传文档（multipart file） |
| GET | `/api/documents` | 是 | 文档列表 |
| DELETE | `/api/documents/:id` | 是 | 删除文档（级联清理向量/图谱/文件） |
| POST | `/api/chat` | 是 | SSE 流式问答（可带 conversationId） |
| GET/PUT | `/api/config` | 是 | 查看/更新 LLM 配置 |
| GET | `/api/conversations` | 是 | 会话列表 |
| GET | `/api/conversations/:id/messages` | 是 | 会话消息（含来源/步骤） |
| GET | `/api/conversations/:id/stats` | 是 | 会话 token 统计 + 摘要 |
| DELETE | `/api/conversations/:id` | 是 | 删除会话（级联清理） |
| GET | `/api/chat/traces` | 是 | 过程追踪列表 |
| GET | `/api/chat/traces/:id` | 是 | 单次提问的过程步骤 |