# Mapa Imóveis São Paulo

Site estático com as **vendas de imóveis registradas no ITBI da Prefeitura de São Paulo, de 2006 a 2026**, da cidade
até o lote. Mostra o R$/m² (mediana de 12 meses, com IQR, intervalo de confiança e n) por **distrito** e por **lote
fiscal**, o volume de vendas, a variação anual, o giro e a parcela de vendas que fica fora do preço, para seis tipos
de imóvel:

Apartamentos · Casas e residências · Terrenos · Lojas, escritórios e comerciais · Garagens e vagas · Galpões logísticos

O preço muda de base com o tipo: R$/m² de área construída (apartamentos, casas, comerciais, galpões), R$/m² de área
do terreno (terrenos) e R$ por unidade (vagas). Há **busca por rua** (índice próprio, sem serviço externo; OpenStreetMap
só como segundo recurso), um **filtro de período** (data inicial até final; vazio = tudo) que filtra os negócios e
recorta os gráficos, e, ao clicar num lote do mapa, um **cartão** com o gráfico das vendas do lote no tempo, a
tabela dos negócios e o atalho para a página do lote.

Páginas: **Cidade** (mapa dos distritos e dos lotes com venda, trajetória do R$/m² por faixa, vendas por trimestre),
**Distrito** (KPIs, pequenos múltiplos contra a cidade, tabela de distritos por tipologia, mapa de calor do que fica
fora do preço, ranking de prédios) e **Prédio / lote** (perfil do IPTU, histórico de vendas do lote, comparáveis do
mesmo estrato no raio, tipologias, todos os negócios). Módulos temáticos: flips (revendas rápidas), aluguel e yield
(agregados), contexto urbano (metrô/trem, zoneamento, equipamentos, parques) e terrenos (lotes reunidos e
lançamentos observados no IPTU/ITBI).

**Publicação:** <https://gtvsantos.github.io/mapa-imoveis-sp/> — GitHub Pages, branch `main`, raiz do repositório
(`.nojekyll` presente para servir pastas e arquivos com `_`).

Este site é um *spin-off* público do protótipo interno "Radar ITBI". As regras de dado (o que é um negócio, o que
entra no preço, como se geolocaliza sem geocoder) estão em `DECISOES.md`, o log de decisões da pesquisa (prefixo
`I-`), mantido junto com o protótipo e citado aqui.

## Abrir localmente

```bash
python3 serve.py            # → http://127.0.0.1:8767/
PORT=8800 python3 serve.py --quiet
```

`serve.py` só entrega os arquivos desta pasta (gzip em memória para `.json` e `.html`, `Cache-Control: no-store`,
sem proxy). Abrir o `index.html` direto do disco (`file://`) mostra só os agregados da cidade: as pastas de dados são
carregadas sob demanda e precisam de um servidor HTTP.

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html` | A página, com `data.json` embutido (agregados da cidade e dos distritos). Montada por `build_site.py`. |
| `data.json` | Cópia dos agregados (a mesma coisa que vai embutida). |
| `ruas.json` | Índice da busca por rua: logradouro → centróide, caixa, nº de negócios e lotes por distrito (carregado ao focar a busca). |
| `dist/{cd}.json` | Um arquivo por distrito (96): série de preço por estrato, lotes com venda (polígono + resumo) e negócios (colunar). ≈270 MB. |
| `flips/` `aluguel/` `contexto/` `terrenos/` | Dados dos módulos temáticos, carregados sob demanda. |
| `src/` | Fonte da página: núcleo (`helpers_siila.js`, `basemap.js`, `app.js`), estilos (`base.css`, `extra.css`, `central.css`), `body.html` e um `m_<tema>.js/.css` por módulo. Espelho de `proto/src`, sem o módulo licenciado. |
| `pipeline/` | Cópia de referência dos scripts públicos da cadeia (não roda daqui; documenta o método). |
| `build_site.py` | Monta o site a partir do protótipo e verifica o que não pode estar aqui. |
| `atualizar_dados.py` | Baixa ITBI novo (e IPTU, opcional), roda a cadeia e remonta o site. |
| `serve.py` | Servidor local de teste. |
| `build_info.json` | Quando e de onde o site foi montado, módulos incluídos, tamanho, nº de arquivos. |
| `atualizacoes.log` | Log das atualizações (fora do git). |
| `.github/workflows/atualizar-dados.yml` | Workflow manual (ver abaixo). |

## Remontar o site (`build_site.py`)

Lê o protótipo (`../data/cache/itbi/proto`, ou `--proto DIR`, ou `PROTO_DIR`) e:

1. espelha `src/` (sem o módulo licenciado e sem `.DS_Store`);
2. copia `data.json` e `ruas.json`;
3. sincroniza `dist/ flips/ contexto/ aluguel/ terrenos/` (só o que mudou de tamanho/mtime; apaga o que sumiu na
   origem; deixa fora `terrenos/por_ref*.json`, duplicatas do Finder como `meta 2.json` e `.DS_Store`);
4. copia os scripts públicos para `pipeline/` (um script que cite a fonte licenciada não é copiado; fica o aviso);
5. roda `proto/assemble.py --src src --data data.json --exclude <módulos> --brand "Mapa Imóveis São Paulo" --flag publico`;
6. **verifica** a pasta inteira: nome ou conteúdo com a palavra que identifica a fonte licenciada, arquivos > 95 MB
   (limite do GitHub: 100 MB), tamanho total e nº de arquivos. Qualquer ocorrência → código de saída 1;
7. grava `build_info.json`.

```bash
python3 build_site.py                 # tudo (≈1 min sem cópia; a primeira cópia dos ~400 MB demora mais)
python3 build_site.py --no-data       # sem as pastas pesadas
python3 build_site.py --check-only    # só a verificação
python3 build_site.py --exclude m_x   # deixa outro módulo fora (o licenciado fica sempre fora)
```

## Atualizar os dados (`atualizar_dados.py`)

**Rotina mensal (um comando):** a Secretaria da Fazenda republica o arquivo do ano corrente perto do fim de cada
mês. Depois disso, na pasta `mapa-imoveis-sp/`:

```bash
python3 atualizar_dados.py --publicar
```

Isso baixa o que mudou, roda a cadeia (~10 min), remonta o site, faz `git commit` + `git push` e o GitHub Pages
republica sozinho em 1–2 minutos em <https://gtvsantos.github.io/mapa-imoveis-sp/>. Sem novidade na Prefeitura, o
script só avisa e sai (e, com `--publicar`, ainda envia qualquer mudança de código já montada). Para conferir antes:

```bash
python3 atualizar_dados.py --dry-run          # lista anos/URLs detectados e o que faria; não baixa nada
python3 atualizar_dados.py --dry-run --head   # idem, conferindo tamanho/last-modified no servidor
python3 atualizar_dados.py                    # baixa o que mudou, roda a cadeia, remonta o site (sem publicar)
python3 atualizar_dados.py --anos 2025 2026   # limita aos anos
python3 atualizar_dados.py --iptu             # também procura exercício novo do IPTU no GeoSampa
python3 atualizar_dados.py --so-baixar | --so-site | --force
```

Só mudou código (em `proto/src`) e quer publicar sem mexer nos dados: `python3 atualizar_dados.py --so-site --publicar`.
Publicar na mão equivale a `git add -A && git commit -m "..." && git push` nesta pasta.

O que faz: (1) lê a página de listagem da Secretaria da Fazenda e extrai os `.xlsx` de ITBI (um por ano; o do ano
corrente traz só a data de geração no nome — gerado em janeiro/fevereiro conta como fechamento do ano anterior);
(2) compara com `raw/itbi_manifest.json` (url, nome, tamanho por HEAD, last-modified); (3) baixa só o que mudou,
um por vez, com 8 s de pausa, validando o xlsx, e **arquiva a geração anterior** em `raw/_geracoes/` (decisão I-026:
a Prefeitura regera os arquivos anuais); (4) roda a cadeia — `01_stage_raw.py <anos>` → `02_typed.py` → `05_geo.py`
→ `06_analitico.py` → `build_data.py` → `build_flips.py`, `build_aluguel.py`, `build_contexto.py`,
`build_terrenos.py` (opcionais) → `build_site.py`; (5) registra em `atualizacoes.log`. Sem novidade, só informa.

Interpretador da cadeia: `python3.12` no PATH, ou `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3`,
ou o que rodou o script (`--python` força). Precisa de `duckdb pandas pyarrow shapely openpyxl`. O próprio
`atualizar_dados.py` roda com qualquer `python3` (só biblioteca padrão); se aparecer `CERTIFICATE_VERIFY_FAILED`,
use o `python3` do Miniforge (que enxerga os certificados do sistema) ou `pip install certifi` no interpretador usado.
O Postgres local não é mais necessário para o build (snapshot dos distritos em `research/stage/geo_distritos.json`).

## Insumos e origem

**Público** (qualquer máquina baixa e regenera):

| Insumo | Origem | Usado em |
|---|---|---|
| Guias de ITBI pagas, 2006–2026 (xlsx anual, ≈500 MB) | Secretaria Municipal da Fazenda, dados abertos | tudo: negócios, preço, volume |
| IPTU / Cadastro Imobiliário Fiscal, 2010–2026 (17 zips, ≈1,1 GB) | GeoSampa (download genérico da camada 352) | atributos da unidade e do prédio, estoque, giro |
| Lotes fiscais (shapefile por distrito, 237 MB) | GeoSampa | polígono e ponto de cada lote (geolocalização sem geocoder) |
| Camadas WFS: metrô/trem, zoneamento, equipamentos, parques, riscos, corredores de ônibus | GeoSampa | módulo contexto |
| Estabelecimentos de saúde | CNES/DATASUS | contexto |
| Escolas e IDEB | INEP | contexto |
| Ocorrências (roubos, furtos) | SSP-SP | contexto (densidade por hexágono) |
| Pontos de interesse | OpenStreetMap | contexto |
| Índice de aluguel e venda da cidade | FipeZap | módulo aluguel (série de contexto) |

**Depende da máquina** (não é regenerável a partir da internet; os arquivos ficam fora deste repositório):

| Insumo | Situação |
|---|---|
| Anúncios QuintoAndar, foto única de 20/06/2026 | Base congelada, usada em `aluguel/` (só agregados) e na estimativa de tipologia (quartos) dos lotes. Não é regenerável. |
| `research/stage/fase2_*.parquet` | Intermediários gerados pelos scripts de pesquisa em `research/fase2/` (A2 flips, A3 terrenos, A4 contexto, A5 aluguel). Os `build_*.py` dos módulos leem estes parquets. |
| Distritos (geometria) | Lidos do Postgres local `imoveis`; `build_data.py` grava um snapshot em `research/stage/geo_distritos.json` a cada execução com banco e usa o snapshot quando o banco não existe (máquina sem Postgres, GitHub Action). |

## GitHub Action mensal (proposta, não ativada)

`.github/workflows/atualizar-dados.yml` tem gatilho manual (`workflow_dispatch`) e o agendamento mensal
**comentado**. A cadeia é toda pública em tese, mas exige ≈2 GB de insumos (ITBI ≈500 MB, IPTU 17 zips ≈1,1 GB,
lotes 237 MB), ≈30 min de processamento e os parquets `fase2_*` que não estão no repositório. Como está, o workflow
só instala as dependências e roda `atualizar_dados.py --dry-run` (mostra o que há de novo na Prefeitura); o passo
de execução real, com commit e push dos JSONs, fica comentado até haver um cache dos insumos e dos `fase2_*`.

## Licenças e atribuição

- **ITBI**: dados abertos da Prefeitura de São Paulo (Secretaria Municipal da Fazenda).
- **GeoSampa** (IPTU, lotes, camadas WFS): CC BY-SA 4.0 — Prefeitura de São Paulo.
- **OpenStreetMap**: ODbL — © colaboradores do OpenStreetMap.
- **Mapa base**: CARTO / OpenFreeMap; **imagens de satélite**: Esri.
- CNES/DATASUS, INEP e SSP-SP: dados públicos dos respectivos órgãos. FipeZap: índice público da Fipe.
- Ícones: Tabler Icons (MIT). Fontes: Hanken Grotesk e Chivo Mono (Google Fonts).

**Aviso:** a versão interna do protótipo usa uma fonte licenciada de lançamentos imobiliários (uso interno). **Nada
dela está neste site** — nem dados, nem módulo, nem nome: `build_site.py` verifica a pasta inteira e recusa a
montagem se encontrar qualquer vestígio.

Código sob a licença que o repositório indicar; os dados seguem as licenças das fontes acima.
