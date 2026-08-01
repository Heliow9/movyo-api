# IA Groq no cadastro de produtos

## Configuração no servidor

Adicione ao `.env` da API (nunca ao Vite/Electron):

```env
GROQ_API_KEY=sua_chave_real
GROQ_TEXT_MODEL=openai/gpt-oss-20b
GROQ_VISION_MODEL=qwen/qwen3.6-27b
GROQ_AUDIO_MODEL=whisper-large-v3-turbo
GROQ_REQUESTS_PER_MINUTE=20
GROQ_REQUESTS_PER_DAY=300
```

Reinicie a API após alterar o `.env`.

## Funcionalidades

- `POST /api/ia/produtos/sugerir`: nome, descrição, imagem, impressão e opções.
- `POST /api/ia/produtos/transcrever`: cadastro por voz em português.
- `POST /api/ia/produtos/importar-cardapio`: OCR de PNG/JPG/WEBP e leitura de PDF com texto.

Todas as rotas exigem o token do restaurante. A chave da Groq não é retornada ao cliente. As sugestões precisam ser confirmadas no formulário antes do cadastro.

PDF digitalizado sem camada de texto deve ser exportado como imagem antes da importação.
