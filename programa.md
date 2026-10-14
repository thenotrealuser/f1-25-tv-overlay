# Continuidade do F1 25 TV Overlay

Projeto ativo: esta pasta (v6). As versões anteriores em `f1-overlay (1)` e `fl-overlay` não são a base atual. Este arquivo registra decisões e limites para continuar a partir da v6, sem recomeçar a implementação.

## O que o usuário quer

- Um overlay externo para F1 25 com aparência próxima das transmissões reais, incluindo torre, cartões de qualificação, identificação onboard e instrumentos encaixados visualmente no halo.
- Cabeçalho `SPRINT` somente durante Sprint Race; `RACE` durante corrida normal.
- Elementos redimensionáveis e reposicionáveis para resoluções e câmeras/carros diferentes, com perfis por equipe para o halo.
- Acelerador e freio progressivos segundo a telemetria, e estados 2026 de asa ativa, Overtake e Boost quando os dados do jogo permitem.
- SC, VSC e bandeira vermelha integrados à torre; delta de VSC/SC separado, somente quando existe; anúncio roxo/preto de volta mais rápida.
- Preservar a instalação e as configurações pessoais ao atualizar. Não chamar de validado no jogo algo visto apenas na demo ou no código.

## Estado herdado da v6

- Servidor Node em `server.js`, página em `overlay.html`, painel em `control.html` e janela Electron em `janela/main.js`. Telemetria UDP em `127.0.0.1:20777`; overlay em `127.0.0.1:8080`.
- Parser 2026 já vinha com sessão, voltas, participantes, telemetria do carro, energia e aerodinâmica. Há modo demo, dumps de Q1 e diagnóstico. A v6 tinha avisos genéricos de SC/VSC/bandeira amarela no topo; ainda faltavam os quatro gráficos pedidos em 14/10.
- `hud-offsets.json`, `hud-scales.json`, `halo-layouts.json` e `curvas/35.json` são dados da instalação. Não substituir em atualizações. `LEIA-ME.md` contém operação e limites detalhados.

## Mudanças de 14/10/2026

- Faixas de SC/VSC dentro do cabeçalho da torre, e bandeira vermelha com faixa/borda vermelha e sobrenomes completos. A torre normal continua usando os códigos dos pilotos.
- Evento UDP `RDFL` liga bandeira vermelha; eventos de retomada/início/fim ou nova sessão a limpam. Evento `SCAR` complementa o estado de SC/VSC informado pela sessão.
- Delta do carro observado lido de `LapData.m_safetyCarDelta` (id 2, deslocamento +28 por carro). Painel central mostra segundos com três casas: positivo verde, negativo vermelho. É oculto sem SC/VSC ou sem amostra recente com valor efetivo; isto permite SC sem delta. Não há bit de disponibilidade específico nesse protocolo, então zero persistente é ambíguo.
- Evento `FTLP` (id 3) aciona por 8 s faixa roxa/preta com piloto, marca da equipe e tempo. Duplicatas do mesmo evento são ignoradas.
- Botões e escala independentes em `/control`; atalho `Ctrl+Alt+V` para volta mais rápida e `Ctrl+Alt+F` para avisos/delta. O modo de edição move e redimensiona ambos. A demo passa por amarela, VSC com delta, SC com delta, SC sem delta e vermelha.
- Arquivos originais e ZIP anteriores foram guardados em `backup-before-race-control-2026-10-14`. O `f1-overlay-2026.zip` foi atualizado com a v6 e as novas funções; ele não deve conter configurações pessoais ou `node_modules`.

## Ajuste pedido depois, em 14/10/2026

- O aviso flutuante de `YELLOW FLAG` foi removido. A bandeira amarela é apresentada somente na torre. O componente flutuante de avisos agora serve apenas ao delta VSC/SC.
- O cartão de volta do jogador fica ligado por padrão, mas só é mostrado em sessões de corrida (tipos UDP 15–17); o modo de edição pode exibi-lo para ajuste. Amarelo sinaliza setor/volta mais lento ou invalidado; verde, melhor marca pessoal; roxo, melhor marca da sessão. A cor usa o último setor concluído durante a volta e a última volta completa no início da volta seguinte. Sem dados suficientes, permanece neutra.
- O cartão de qualificação de três pilotos não recebeu essa restrição de corrida. A atualização de cor do cartão de corrida usa os tempos recebidos, sem inventar comparação com uma volta em andamento antes do primeiro setor.

### Correção após relato de corrida real

- O usuário constatou que o cartão aparecia na corrida mas não acendia as parciais. Causa no código: `fillCard` exigia `driverStatus === 1` (`flying lap`), enquanto na corrida o jogo informa `driverStatus === 4` (`on track`). O cartão de corrida agora aceita 4, mantendo a condição antiga no cartão da qualificação.
- O S3, antes sempre vazio na tela, é obtido ao mudar o número da volta: última volta menos S1 e S2 da volta encerrada. O cartão mantém S1/S2/S3 da volta encerrada visíveis por 5 s, compara cada setor ao melhor pessoal e da sessão e retoma as parciais da nova volta. A demo de corrida passou a usar `on track` para representar o jogo.
- Ainda não havia dump de corrida real disponível nesta atualização; as transições e a classificação do S3 precisam ser conferidas com telemetria gravada durante uma volta completa.

## Estado da verificação e próximos cuidados

- A leitura anterior dos dumps reais comprova apenas as situações capturadas naquela Q1; esses dumps não incluem uma corrida real em SC/VSC, bandeira vermelha ou FTLP. As HUDs novas ainda exigem captura visual e UDP durante esses eventos para conferir transições e semelhança com a transmissão. A janela Electron e o encaixe por carro também precisam de conferência no F1 25.
- Para verificar SC sem delta, capture pacotes de sessão (id 1), volta (id 2) e evento (id 3) durante entrada, circulação e saída do SC. Se o jogo mantiver valores não zero mesmo quando o delta não for exigido, refine a regra de disponibilidade com evidência real.
- A especificação usada é a de estruturas UDP do 2026 Season Pack publicada pela EA: `https://forums.ea.com/t5/s/tghpe58374/attachments/tghpe58374/f1-games-game-info-hub-en/61/8/2026%20Season%20Pack%20Telemetry%20Output%20Structures%20(1).txt`. A interpretação de delta positivo/negativo segue a explicação da FIA: `https://www.fia.com/news/fia-insights-developing-new-delta-for-double-yellow-flag-zones`.
- Há outros elementos de transmissão possíveis (penalidades, tela final, pit stop, ordem ao vivo). Implementá-los exige ligar cada gráfico a um campo/evento validado na telemetria, evitando animações que inventem fatos da corrida.
