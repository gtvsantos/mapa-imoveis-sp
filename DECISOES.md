# Decisões do Mapa Imóveis São Paulo

Log em que só se acrescenta. As regras de dado (o que é um negócio, o que entra no preço, geolocalização cadastral,
séries, giro) vêm da pesquisa do protótipo interno "Radar ITBI" e estão registradas lá com o prefixo `I-`
(`fii_quant/data/cache/itbi/research/DECISOES.md`); este arquivo repete só o que o site público precisa saber e
registra o que é próprio dele, com o prefixo `S-`.

## Regras herdadas (resumo)

- **Negócio** = SQL + data do instrumento + matrícula (na planta, o complemento). Guias de vários compradores são
  somadas; duplicatas e retificações em ≤ 90 dias colapsam.
- **Preço** = só negócios com SQL próprio e sem nenhuma sinalização (valor simbólico, abaixo de 30% do valor venal de
  referência, venda em bloco de ≥ 5 unidades, fora do piso/teto, fora de 3,5·MAD dentro de distrito × tipo × faixa ×
  ano). Unidades vendidas na planta sobre o SQL do terreno entram no volume, nunca no preço.
- **Série** = mediana móvel de 4 trimestres com IQR e n; IC95% da mediana ≈ mediana ± 1,58·IQR/√n; n < 10 fica cinza.
- **Mapa** = coordenada só do cadastro (SQL → IPTU → polígono do lote fiscal do GeoSampa). Nenhum geocoder.
- **Área** = construída do IPTU (inclui a fração das áreas comuns).

## S-001 · Seis tipos de imóvel, preço na base de cada um (30/09/2026)

Apartamentos (usos IPTU 20 e 25) · Casas e residências (10, 12, 13, 14) · Terrenos (0) · Lojas, escritórios e comerciais
(30, 85, 40, 41, 42, 31) · Garagens e vagas (23, 24, 62, 63) · Galpões logísticos (50 indústria e 51 armazéns/depósitos).
Apartamentos, casas, comerciais e galpões em **R$/m² de área construída**; terrenos em **R$/m² de área do terreno**;
vagas em **R$ por unidade**. Pisos e tetos: 500–60.000 R$/m² construído; 30–100.000 R$/m² de terreno; 3.000–1.500.000
R$ por vaga. Faixas de tamanho próprias para terreno (≤150 … >5.000 m² de terreno) e galpão (≤300 … >2.500 m²).
Bases diferentes nunca se misturam: o preço de um lote usa só os negócios do grupo do seu tipo predominante.
(Detalhe: I-036.)

## S-002 · Busca por rua sem serviço externo (30/09/2026)

Índice estático `ruas.json`, gerado no build a partir do logradouro das guias de ITBI dos negócios com lote: nome,
centróide, caixa, nº de negócios e os lotes por distrito. Busca no navegador por prefixo normalizado (sem acento nem
caixa), até 8 sugestões. Escolher voa para a rua e realça os lotes dela. Rua sem venda registrada não está no índice:
aí o Nominatim (OpenStreetMap, ODbL) entra como segundo recurso, só quando a busca local não acha nada, com a
atribuição na tela. (I-037.)

## S-003 · O que este site NÃO tem (30/09/2026)

- Nenhum dado da fonte licenciada de lançamentos usada na versão interna: nem arquivos, nem páginas (Lançamento,
  Primário), nem selos, nem a sigla em qualquer arquivo. `build_site.py` verifica a pasta inteira e recusa a montagem
  se encontrar algo.
- Nenhum prédio LiDAR nem lote neutro do GeoSampa servidos por API: o site é estático. Os prédios 3D vêm do
  OpenStreetMap (OpenFreeMap) e os lotes mostrados são os que têm venda registrada. Lotes neutros por PMTiles são
  uma possibilidade ainda não decidida.
- Nenhum anúncio individual: a base de anúncios usada em aluguel/yield e nas tipologias dos lotes é uma foto única
  (20/06/2026), só em agregados com n. A permanência desses agregados num site público ainda está sob avaliação.

## S-004 · Publicação e atualização (30/09/2026)

GitHub Pages, branch `main`, raiz, `.nojekyll`. Repositório privado até o aval do dono; público e com Pages só quando
ele mandar. Atualização mensal pelo `atualizar_dados.py` na máquina de origem (o GitHub Action fica só com gatilho
manual até haver cache dos insumos, ~2 GB, e dos parquets intermediários da pesquisa). Cada nova geração dos xlsx da
Prefeitura é arquivada antes de sobrescrever (I-026). O build de agregados dispensa o banco local desde 30/09 (snapshot
dos distritos). (I-040, I-041.)
