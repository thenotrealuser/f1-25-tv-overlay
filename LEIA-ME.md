# F1 25 TV Overlay — 2026 Season Pack

HUD estilo transmissão de TV para o F1 25. Lê a telemetria UDP oficial do jogo e desenha por cima da tela. Não altera arquivos nem memória do jogo.

## Começar

1. Instale o Node.js 18 ou mais recente.
2. Dê dois cliques em `iniciar-overlay.bat`. Na primeira execução, o Electron será instalado na pasta `janela` (precisa de internet).
3. Coloque o jogo em **Janela (Tela Cheia)**.
4. No jogo, em **Configurações > Configurações de telemetria**: UDP ligada; modo de transmissão **Não**; IP `127.0.0.1`; porta `20777`; 20 Hz; formato **2026** para a DLC.
5. Entre numa sessão. O modo Qualificação/Corrida muda automaticamente conforme o tipo de sessão.

Com apenas o servidor, abra `iniciar.bat` e visite `http://127.0.0.1:8080/` no navegador. Também é possível usar essa URL como Browser Source no OBS (1920×1080, fundo transparente).

## Atalhos e botões

Com a janela Electron aberta, os atalhos globais funcionam mesmo com o jogo em foco:

| Atalho | Ação |
|---|---|
| Ctrl+Alt+H, Ctrl+Shift+H ou Ctrl+Alt+F10 | HUD inteiro (3 alternativas; ao abrir, o overlay avisa na tela se algum estiver ocupado) |
| Ctrl+Alt+T | Torre de tempos |
| Ctrl+Alt+F | Avisos na torre (amarela, SC, VSC, vermelha) e delta SC/VSC |
| Ctrl+Alt+V | Anúncio de volta mais rápida |
| Ctrl+Alt+L | Cartão da volta do jogador (visível somente em corrida) |
| Ctrl+Alt+O | Cartão onboard e halo |
| Ctrl+Alt+G | Somente o halo |
| Ctrl+Alt+K | Cartões de volta lançada (qualificação) |
| Ctrl+Alt+E ou Ctrl+Shift+E | Modo de edição (mover/redimensionar HUDs) |
| Ctrl+Alt+M | Alterna Automático → Qualificação → Corrida |

No navegador, as teclas `H`, `T`, `K`, `F`, `V`, `L`, `O`, `G`, `M` fazem as mesmas ações quando a página do overlay tem foco. Há botões em `http://127.0.0.1:8080/control`. Um aviso aparece por 1,8 segundo após cada ação.

## Ajustar tamanho e posição

Abra `http://127.0.0.1:8080/control` no navegador. Em **Tamanho de cada HUD**, ajuste separadamente torre, cartão onboard, halo, avisos/delta, anúncio de volta mais rápida, cartões da qualificação e cartão da volta. Cada controle vai de 0,3× a 3×, e 1× é o tamanho original. Os valores são salvos em `hud-scales.json` e reaplicados ao iniciar o programa.

Em **Ajuste do halo**, configure posição horizontal, vertical e tamanho para o carro da equipe atual. Isso ajuda a encaixar os instrumentos nas câmeras de carros diferentes. O perfil é salvo em `halo-layouts.json`; o perfil Padrão vale para equipes sem ajuste próprio. O tamanho geral do halo multiplica o tamanho definido para a equipe. O desenho do halo foi ampliado; os ajustes anteriores desta instalação estão guardados em `halo-layouts-before-redesign.json`.

Ative **Onboard: cartão + halo** para exibir nome, equipe, símbolo estilizado e número do piloto observado. A telemetria UDP não informa qual câmera está ativa; ligue e desligue esse modo manualmente conforme a transmissão.

## Modos

- **Qualificação e treino:** torre em ordem da posição informada pelo jogo, melhor volta, diferença para a melhor geral, cronômetro para quem está em volta lançada, indicador BOX/IN/OUT e cartão com S1/S2 do jogador. O S3 da volta atual ainda não vem pronto nessa telemetria e aparece como `—` até termos uma leitura confiável. Cabeçalho com Q1/Q2/Q3 e tempo restante. A linha vermelha de eliminação é uma aproximação para grids de 20 ou 22 carros.
- **Corrida:** torre com posições, diferenças, pneu, PIT/OUT e cabeçalho com volta atual/total. O cabeçalho mostra **SPRINT** somente quando a estrutura do fim de semana indica Sprint Race; em corrida normal, mostra **RACE**. `?gap=leader` troca o intervalo para o líder (padrão: carro da frente).
- `?rows=10` limita a torre a dez pilotos. `?debug` mostra contadores de pacotes no canto.

## Testar sem o jogo

- `iniciar-demo.bat`: corrida com dados simulados.
- `node server.js --demo --quali`: qualificação simulada.
- `node verificar-dump.js`: confere a leitura de dumps reais gravados localmente em `dump/`; essas capturas não são incluídas no repositório.
- `node verificar-janela.js`: diagnóstico legado da inicialização da janela e dos atalhos; a lista atual está na tabela acima.
- Em duas janelas: `node server.js` e `node replay-dump.js`. Abra o overlay no navegador para reproduzir os dumps gravados. Essa reprodução usa uma amostra parada, não simula uma volta em movimento.

## Diagnóstico no jogo

Feche os outros servidores e abra `diagnostico.bat`. Ele grava uma amostra por tipo de pacote em `dump/id*.bin` e amostra os dados do seu carro dos pacotes 2, 6 e 7 a cada 500 ms em `dump/player-samples.jsonl`. Faça uma volta real para investigar os campos de aerodinâmica e consumo da bateria de 2026. Pare com Ctrl+C e envie o arquivo se quiser continuar essa análise. O arquivo cresce enquanto o diagnóstico estiver aberto.

## Limites verificados

O parser 2026 foi validado com os dumps reais de uma Q1: 22 pilotos ativos em 24 slots, nomes, posições, última volta, tipo de sessão e energia ERS. A melhor volta de cada piloto vem do histórico de sessão; até esse pacote chegar, a última volta funciona como valor provisório. A compatibilidade com formato 2025 conserva o layout anterior, mas não foi testada com uma captura real nesta versão.

A janela transparente, o encaixe visual dos instrumentos nas câmeras e os atalhos globais ainda precisam ser conferidos com o F1 25 aberto. O campo DRS foi escondido no formato 2026. No HUD do halo, freio e acelerador mostram o valor contínuo de 0 a 100% do pacote id 6; se o dispositivo de entrada só enviar 0% ou 100%, a telemetria também será binária. O modo de asas e a disponibilidade/ativação do Overtake vêm do pacote id 16. A distância para ativação também vem desse pacote. O Boost é indicado pelo modo ERS do pacote id 7, separado do Overtake. A escala de bateria de 2026 ainda é experimental.


## Halo: estados e número da curva
- BOOST, OVERTAKE e ACTIVE AERO (DRS no formato 2025) têm 3 estados: cinza apagado = indisponível, contorno verde pulsando = disponível (READY), verde cheio = em uso (ON). A asa ativa em amarelo = zona se aproximando (IN x M).
- TURN mostra o número da curva (T7/19). O jogo não envia isso, então o overlay aprende cada pista na primeira volta completa, sem pit, e salva em `curvas/<id da pista>.json`. Enquanto aprende aparece "…". Pode divergir da numeração oficial; edite o arquivo ou apague para reaprender.


## Pausa, qualificação e modo de edição
- **Jogo em pausa:** a HUD não some mais quando os pacotes param; ela fica congelada com o aviso "JOGO EM PAUSA" (some só após 15 min sem dados ou pelo atalho do HUD).
- **Qualificação:** torre no estilo da transmissão (tempo do líder, gaps, pneu em letra, faixa ELIMINATION ZONE em Q1/Q2) e, embaixo, até 3 cartões dos pilotos em volta lançada: tempo da volta, tempo de referência (líder, ou o último que passa se o piloto está na zona de eliminação) com o nome, delta por 5 s ao fechar cada setor e barra S1/S2/S3 em verde (melhorou o próprio melhor), amarelo (perdeu tempo) e roxo (melhor setor de todos).
- **Modo de edição** (Ctrl+Alt+E ou botão em /control): a janela fica clicável, todas as HUDs aparecem com contorno amarelo; arraste para mover, canto amarelo ou roda do mouse para redimensionar, duplo clique reseta, Esc ou o atalho de novo sai. Os dados ficam congelados enquanto edita. Pause o jogo pelo menu dele antes (o overlay não envia teclas ao jogo, por causa do EA AntiCheat). Posições e tamanhos ficam salvos em `hud-offsets.json`, `hud-scales.json` e `halo-layouts.json`.


## Painel de controle e HUDs independentes
- Ao iniciar, o servidor abre sozinho o painel de controle no navegador (`http://127.0.0.1:8080/control`). Para não abrir, use `node server.js --no-open`.
- Cada HUD liga e desliga sozinha: torre, cartões de volta (qualy), halo, cartão onboard e cartão da volta (o onboard e o halo não andam mais juntos). O cartão da volta fica habilitado por padrão, mas só é exibido durante corridas; no modo de edição pode ser visto para ajuste.
- Nos cartões de volta da qualificação, o primeiro é sempre o piloto que você controla (mostra BOXES / OUT LAP / IN LAP e a melhor volta quando fora de volta lançada); os outros dois são pilotos em volta lançada.


## Avisos de pista, delta e volta mais rápida
- **Avisos na torre:** bandeira amarela, Safety Car e Virtual Safety Car aparecem no cabeçalho da torre, sem aviso amarelo flutuante. A amarela vem das zonas de fiscais ou da bandeira mostrada ao jogador. SC/VSC vêm do estado no pacote de sessão (id 1) ou do evento `SCAR` (id 3). A bandeira vermelha usa o evento `RDFL` e troca a torre para faixa vermelha, borda vermelha e nomes completos; é limpa quando chegam eventos de início/retomada/fim de sessão ou uma nova sessão. Ligue/desligue os avisos em `/control` ou com Ctrl+Alt+F.
- **Delta VSC/SC:** painel separado e ajustável por posição/tamanho. Lê `m_safetyCarDelta` do carro observado no pacote de volta (id 2). Delta positivo é mostrado em verde; negativo, em vermelho. Na volta de Safety Car sem delta, o painel fica oculto. O protocolo não informa separadamente quando o delta deixa de ser exigido; por isso o painel depende de uma amostra válida recente e de valor diferente de zero recente. Perto de zero contínuo por mais de 1 s pode ocultar o painel mesmo que o delta ainda esteja ativo.
- **Volta mais rápida:** o evento `FTLP` (id 3) mostra por oito segundos uma faixa roxa/preta com nome, marca de equipe e tempo. É independente dos cartões de qualificação e pode ser ligado/desligado com Ctrl+Alt+V. Arraste ou redimensione no modo de edição.
- **Demo:** alterna bandeira amarela, VSC com delta, SC com delta, SC sem delta e bandeira vermelha; anuncia uma volta mais rápida simulada a cada 36 s. A aparência e a interpretação dos eventos ainda precisam ser conferidas com captura real dessas situações no F1 25.
- O painel do carro foi removido.
- O cartão da volta do piloto controlado usa o formato dos cartões da qualificação e aparece somente em corrida. O estado UDP `on track` (4) mantém o cronômetro e as parciais ativos; `flying lap` (1) continua atendendo à qualificação. Cada setor concluído acende amarelo quando mais lento, verde para melhor marca pessoal ou roxo para melhor marca da sessão. O S3 é calculado ao cruzar a linha (`última volta − S1 − S2`) e as três barras da volta fechada permanecem por 5 s. A cor do cartão segue o último setor concluído e, no começo da volta seguinte, a última volta completa. Sem tempo válido, fica neutro. O resultado deve ser conferido em captura real de corrida.
