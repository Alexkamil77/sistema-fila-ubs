// public/js/sala_espera_cliente.js
document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    const chamadaPacienteDisplay = document.getElementById('chamadaPacienteDisplay');
    const waitingListDisplay = document.getElementById('waitingListDisplay');
    const dateTimeDisplay = document.getElementById('dateTimeDisplay');
    const activateSoundButton = document.getElementById('activateSoundButton');

    let callInterval = null;
    const synth = window.speechSynthesis;
    let femaleVoice = null;
    let audioActivated = false;

    let ytPlayer;
    let lastValidPlaylistUrl = null;
    let currentInitialData = null;
    const VIDEO_DEFAULT_VOLUME = 40; // Define o volume padrão do vídeo (seus 40%)

    // Função chamada automaticamente quando a API do YouTube estiver pronta
    function onYouTubeIframeAPIReady() {
        console.log('SALA_ESPERA: >>> YouTube Iframe API Ready. <<<');
        try {
            ytPlayer = new YT.Player('youtubePlayer', {
                height: '100%', width: '100%',
                playerVars: {
                    'autoplay': 1,       // Inicia o vídeo automaticamente
                    'controls': 0,       // Oculta os controles do player
                    'loop': 1,           // Faz o vídeo repetir
                    'playsinline': 1,    // Permite reprodução inline em iOS
                    'origin': window.location.origin, // Necessário para algumas APIs
                    'iv_load_policy': 3, // Oculta anotações
                    'modestbranding': 1, // Remove o logo do YouTube na barra de controle
                    'rel': 0             // Não mostra vídeos relacionados ao final
                },
                events: {
                    'onReady': onPlayerReady,
                    'onStateChange': onPlayerStateChange,
                    'onError': onPlayerError
                }
            });
        } catch (e) {
            console.error("SALA_ESPERA: Erro ao tentar criar YT.Player:", e);
        }
    }
    // Atribua a função globalmente para que a API do YouTube possa chamá-la
    window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

    // Adiciona o script da API do YouTube ao documento
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api"; // URL correta para a API do YouTube
    const firstScriptTag = document.getElementsByTagName('script')[0];
    if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    } else {
        document.head.appendChild(tag);
    }

    // Função chamada quando o player do YouTube está pronto
    function onPlayerReady(event) {
        console.log('SALA_ESPERA: >>> YouTube Player Ready. <<<');
        if (event && event.target && typeof event.target.setVolume === 'function') {
            event.target.setVolume(VIDEO_DEFAULT_VOLUME); // Define o volume inicial
            console.log(`SALA_ESPERA: Volume do player do YouTube definido para ${VIDEO_DEFAULT_VOLUME}.`);
        }
        let urlToLoad = null;
        if (lastValidPlaylistUrl) {
            urlToLoad = lastValidPlaylistUrl;
            console.log('SALA_ESPERA (onPlayerReady): Carregando URL pendente de lastValidPlaylistUrl:', urlToLoad);
        } else if (currentInitialData && currentInitialData.currentPlaylistUrl && currentInitialData.currentPlaylistUrl !== "https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG") {
            urlToLoad = currentInitialData.currentPlaylistUrl;
            console.log('SALA_ESPERA (onPlayerReady): Carregando URL pendente de initialData:', urlToLoad);
        }
        if (urlToLoad) {
            loadYouTubeContent(urlToLoad);
        } else {
            console.log('SALA_ESPERA (onPlayerReady): Nenhuma URL pendente para carregar.');
        }
    }

    // Função chamada quando o estado do player muda (ex: tocando, pausado, etc.)
    function onPlayerStateChange(event) {
        console.log('SALA_ESPERA: YouTube Player State Change:', event.data, '(Estado Atual)');
        // Garante que o volume seja sempre o padrão quando o vídeo está tocando,
        // a menos que esteja durante uma chamada (volume 0).
        if (event.data === YT.PlayerState.PLAYING) {
            if (ytPlayer && typeof ytPlayer.getVolume === 'function' && ytPlayer.getVolume() !== 0) {
                 ytPlayer.setVolume(VIDEO_DEFAULT_VOLUME);
            }
        }
        if (event.data === YT.PlayerState.ENDED) {
            console.log('SALA_ESPERA: Vídeo/Playlist terminou. Loop é geralmente tratado por params da URL/playerVars.');
            // Se o loop não estiver funcionando, você pode adicionar ytPlayer.playVideo(); aqui para reiniciar.
        }
    }

    // Função chamada em caso de erro no player do YouTube
    function onPlayerError(event) {
        console.error('SALA_ESPERA: Erro no Player do YouTube:', event.data, 'Para URL:', lastValidPlaylistUrl);
        const playerContainer = document.getElementById('youtubePlayer');
        let errorMessage = 'Erro ao carregar vídeo.';
        if (event.data === 2) errorMessage = 'URL do vídeo/playlist parece inválida.';
        if (event.data === 5) errorMessage = 'Conteúdo não pode ser reproduzido (erro HTML5).';
        if (event.data === 100) errorMessage = 'Vídeo não encontrado (removido ou privado).';
        if (event.data === 101 || event.data === 150) errorMessage = 'Incorporação não permitida pelo proprietário.';
        if (playerContainer) {
            playerContainer.innerHTML = `<p style="color:white; text-align:center; padding-top: 20%; font-size:1.2em;">${errorMessage}</p>`;
        }
    }

    // Função para carregar conteúdo (vídeo ou playlist) do YouTube
    function loadYouTubeContent(playlistUrlToLoad) {
        if (!ytPlayer || typeof ytPlayer.loadVideoById !== 'function') {
            console.warn("SALA_ESPERA (loadYouTubeContent): ytPlayer não está pronto, URL continua pendente:", playlistUrlToLoad);
            lastValidPlaylistUrl = playlistUrlToLoad;
            return;
        }
        console.log('SALA_ESPERA (loadYouTubeContent): Processando URL:', playlistUrlToLoad);
        lastValidPlaylistUrl = playlistUrlToLoad;
        let videoId = '';
        let playlistId = '';
        let startSeconds = 0;
        let isPlaylist = false;

        try {
            let tempUrl = playlistUrlToLoad;
            // Garante que a URL tem um protocolo para ser parseada pela URL API
            if (!tempUrl.startsWith('http://') && !tempUrl.startsWith('https://')) {
                if (!tempUrl.startsWith('//')) tempUrl = '//' + tempUrl;
                if (!tempUrl.startsWith('https://')) tempUrl = 'https:' + tempUrl;
            }
            const urlObj = new URL(tempUrl);
            console.log("SALA_ESPERA (loadYouTubeContent): Objeto URL criado. Pathname:", urlObj.pathname, "Search:", urlObj.search);

            // Tenta extrair ID da playlist primeiro
            let extractedListParam = urlObj.searchParams.get('list');
            if (extractedListParam && typeof extractedListParam === 'string' && extractedListParam.trim() !== '') {
                playlistId = extractedListParam;
                isPlaylist = true;
                console.log("SALA_ESPERA (loadYouTubeContent): ID da Playlist (de urlObj.searchParams.get):", playlistId);
            } else {
                // Fallback manual para 'list' se searchParams.get falhar (alguns formatos de URL)
                const searchString = urlObj.search;
                const listParamKey = "list=";
                const listParamStartIndex = searchString.indexOf(listParamKey);

                if (listParamStartIndex !== -1) {
                    let potentialPlaylistId = searchString.substring(listParamStartIndex + listParamKey.length);
                    const ampersandIndex = potentialPlaylistId.indexOf('&');
                    if (ampersandIndex !== -1) {
                        potentialPlaylistId = potentialPlaylistId.substring(0, ampersandIndex);
                    }
                    if (potentialPlaylistId) {
                        playlistId = potentialPlaylistId;
                        isPlaylist = true;
                        console.log("SALA_ESPERA (loadYouTubeContent): ID da Playlist (de FALLBACK MANUAL):", playlistId);
                    }
                }
            }

            // Se não for playlist, tenta extrair ID do vídeo
            if (!isPlaylist) {
                // Tenta extrair ID de URLs padrão (v=, embed/, youtu.be/)
                const videoIdParam = urlObj.searchParams.get('v');
                if (videoIdParam) {
                    videoId = videoIdParam;
                    console.log("SALA_ESPERA (loadYouTubeContent): ID do Vídeo (de 'v='):", videoId);
                } else if (urlObj.pathname.includes('/embed/') || urlObj.hostname === 'youtu.be') {
                    const pathSegments = urlObj.pathname.split('/');
                    const potentialId = pathSegments[pathSegments.length - 1];
                    if (potentialId && potentialId.length === 11) { // IDs de vídeo têm 11 caracteres
                        videoId = potentialId;
                        console.log("SALA_ESPERA (loadYouTubeContent): ID do Vídeo (de /embed/ ou youtu.be):", videoId);
                    }
                }
            }

            // Extrai o tempo de início, se presente
            const timeParam = urlObj.searchParams.get('t') || urlObj.searchParams.get('start');
            if (timeParam) {
                let totalSeconds = 0;
                const parts = timeParam.match(/(\d+h)?(\d+m)?(\d+s)?/);
                if (parts) {
                    totalSeconds += parseInt(parts[1] || '0') * 3600;
                    totalSeconds += parseInt(parts[2] || '0') * 60;
                    totalSeconds += parseInt(parts[3] || '0');
                }
                if (!totalSeconds) { // Caso seja apenas segundos numéricos
                    const numSeconds = parseInt(timeParam);
                    if (!isNaN(numSeconds)) totalSeconds = numSeconds;
                }
                if (totalSeconds > 0) startSeconds = totalSeconds;
                console.log("SALA_ESPERA (loadYouTubeContent): Tempo de início extraído:", startSeconds);
            }

        } catch (e) {
            console.error("SALA_ESPERA (loadYouTubeContent): Erro ao parsear URL:", e);
            const playerContainer = document.getElementById('youtubePlayer');
            if (playerContainer) {
                playerContainer.innerHTML = '<p style="color:white; text-align:center; padding-top: 20%; font-size:1.2em;">Erro ao processar URL do vídeo. Verifique o formato.</p>';
            }
            return;
        }

        const playerContainer = document.getElementById('youtubePlayer');
        // Limpa mensagens de erro ou conteúdo anterior do playerContainer
        if (playerContainer && playerContainer.firstChild && playerContainer.firstChild.tagName === 'P') {
            console.log("SALA_ESPERA (loadYouTubeContent): Limpando mensagem de erro anterior do playerContainer.");
            playerContainer.innerHTML = '';
        }

        // Para evitar problemas, pare o vídeo atual antes de carregar um novo
        if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
            ytPlayer.stopVideo();
        }

        if (isPlaylist && playlistId) {
            console.log('SALA_ESPERA (loadYouTubeContent): Carregando PLAYLIST com ID:', playlistId, 'index: 0, startSeconds:', startSeconds);
            ytPlayer.loadPlaylist({ list: playlistId, listType: 'playlist', index: 0, startSeconds: startSeconds });
        } else if (videoId) {
            console.log('SALA_ESPERA (loadYouTubeContent): Carregando VÍDEO com ID:', videoId, 'em', startSeconds, 's');
            ytPlayer.loadVideoById({ videoId: videoId, startSeconds: startSeconds });
        } else {
            console.warn('SALA_ESPERA (loadYouTubeContent): FINAL: Não foi possível extrair um ID de vídeo ou playlist válido da URL:', playlistUrlToLoad);
            if (playerContainer) {
                playerContainer.innerHTML = '<p style="color:white; text-align:center; padding-top: 20%; font-size:1.2em;">URL do vídeo/playlist inválida ou não reconhecida.</p>';
            }
        }
    }

    // --- Funções de Controle de Volume do YouTube ---
    /**
     * Silencia o áudio do vídeo do YouTube.
     */
    function muteYouTubeVideo() {
        if (ytPlayer && typeof ytPlayer.mute === 'function') {
            ytPlayer.mute();
            console.log("SALA_ESPERA: Vídeo do YouTube silenciado.");
        } else {
            console.warn("SALA_ESPERA: Player do YouTube não está pronto ou mute() não está disponível.");
        }
    }

    /**
     * Define o volume do vídeo do YouTube para o volume padrão (VIDEO_DEFAULT_VOLUME) e garante que não está mutado.
     */
    function unmuteYouTubeVideoAndSetDefaultVolume() {
        if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
            ytPlayer.unMute(); // Garante que não está mutado
            ytPlayer.setVolume(VIDEO_DEFAULT_VOLUME);
            console.log(`SALA_ESPERA: Volume do vídeo do YouTube definido para ${VIDEO_DEFAULT_VOLUME}%.`);
        } else {
            console.warn("SALA_ESPERA: Player do YouTube não está pronto ou setVolume() não está disponível.");
        }
    }

    // --- Funções de Controle de Áudio e UI (Speech Synthesis e Botão Ativar Som) ---
    if (activateSoundButton) {
        activateSoundButton.addEventListener('click', () => {
            audioActivated = true;
            if (synth.paused) synth.resume();

            // Tenta ativar o som do vídeo do YouTube também, já que é uma interação do usuário
            if (ytPlayer) {
                ytPlayer.unMute();
                ytPlayer.setVolume(VIDEO_DEFAULT_VOLUME);
                console.log('SALA_ESPERA: Som do YouTube ativado por interação do usuário.');
            }

            const testUtterance = new SpeechSynthesisUtterance('Áudio ativado.');
            testUtterance.volume = 0.01; testUtterance.lang = 'pt-BR';
            if (femaleVoice) testUtterance.voice = femaleVoice;
            testUtterance.onend = () => {
                console.log('SALA_ESPERA: Fala de teste concluída.');
                if (chamadaPacienteDisplay && chamadaPacienteDisplay.dataset.currentPatientName && chamadaPacienteDisplay.dataset.currentCalledBy) {
                    announcePatient(chamadaPacienteDisplay.dataset.currentPatientName, chamadaPacienteDisplay.dataset.currentCalledBy, true);
                }
            };
            testUtterance.onerror = (e) => {
                console.warn('SALA_ESPERA: Erro na fala de teste:', e.error);
                if (chamadaPacienteDisplay && chamadaPacienteDisplay.dataset.currentPatientName && chamadaPacienteDisplay.dataset.currentCalledBy) {
                    announcePatient(chamadaPacienteDisplay.dataset.currentPatientName, chamadaPacienteDisplay.dataset.currentCalledBy, true);
                }
            };
            synth.speak(testUtterance);
            activateSoundButton.classList.add('hidden');
            console.log('SALA_ESPERA: Interação para áudio.');
        });
    }

    // Carrega as vozes disponíveis para a Speech Synthesis API
    function loadVoices() {
        const voices = synth.getVoices();
        femaleVoice = voices.find(v => v.lang === 'pt-BR' && v.name.toLowerCase().includes('female')) || voices.find(v => v.lang === 'pt-BR');
        if (!femaleVoice && voices.length === 0 && speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = () => {
                speechSynthesis.onvoiceschanged = null; // Remove o listener após carregar
                const updatedVoices = synth.getVoices();
                femaleVoice = updatedVoices.find(v => v.lang === 'pt-BR' && v.name.toLowerCase().includes('female')) || updatedVoices.find(v => v.lang === 'pt-BR');
                console.log(femaleVoice ? `Voz PT-BR (onchange): ${femaleVoice.name}` : "Nenhuma voz PT-BR feminina (onchange).");
            };
        } else {
            console.log(femaleVoice ? `Voz PT-BR inicial: ${femaleVoice.name}` : "Nenhuma voz PT-BR feminina inicial.");
        }
    }
    loadVoices(); // Chama para carregar as vozes

    // Função para que a Speech Synthesis API "fale" um texto
    function speak(text) {
        if (!audioActivated && activateSoundButton && !activateSoundButton.classList.contains('hidden')) {
            activateSoundButton.classList.add('highlight-needed');
            return; // Impede a fala se o som não foi ativado
        }
        if (activateSoundButton) {
            activateSoundButton.classList.remove('highlight-needed');
        }

        if (synth.speaking) { // Se já estiver falando, cancela e inicia uma nova fala com um pequeno delay
            synth.cancel();
            setTimeout(() => {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'pt-BR';
                if (femaleVoice) utterance.voice = femaleVoice;
                utterance.pitch = 1; utterance.rate = 1; utterance.volume = 1;
                utterance.onerror = (e) => console.error('SALA_ESPERA: Erro Speech API (speak):', e.error);
                synth.speak(utterance);
            }, 50);
            return;
        }
        if (text) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'pt-BR';
            if (femaleVoice) utterance.voice = femaleVoice;
            utterance.pitch = 1; utterance.rate = 1; utterance.volume = 1;
            utterance.onerror = (e) => console.error('SALA_ESPERA: Erro Speech API (speak):', e.error);
            synth.speak(utterance);
        }
    }

    // Anuncia a chamada do paciente
    function announcePatient(patientName, professionalName, forceSpeak = false) {
        // Se o áudio não foi ativado pela interação do usuário, e não é uma chamada forçada
        if (!audioActivated && !forceSpeak && activateSoundButton && !activateSoundButton.classList.contains('hidden')) {
            if (chamadaPacienteDisplay) {
                // Armazena dados para tentar falar novamente após ativação
                chamadaPacienteDisplay.dataset.currentPatientName = patientName;
                chamadaPacienteDisplay.dataset.currentCalledBy = professionalName;
                chamadaPacienteDisplay.innerHTML = `<span>${patientName.toUpperCase()}</span><span class="sala">Consultório: ${professionalName} <br>(Som desativado)</span>`;
            }
            if(activateSoundButton) activateSoundButton.classList.add('highlight-needed');
            return;
        }
        if (activateSoundButton) {
            activateSoundButton.classList.remove('highlight-needed');
        }
        // Limpa os dados armazenados se a fala for ativada
        if(chamadaPacienteDisplay) {
            delete chamadaPacienteDisplay.dataset.currentPatientName;
            delete chamadaPacienteDisplay.dataset.currentCalledBy;
        }

        const announcementText = `Paciente ${patientName}, por favor, dirija-se ao consultório de ${professionalName}.`;
        if(chamadaPacienteDisplay) {
            chamadaPacienteDisplay.innerHTML = `<span>${patientName.toUpperCase()}</span><span class="sala">Consultório: ${professionalName}</span>`;
        }

        // Limpa qualquer intervalo de chamada anterior e cancela falas pendentes
        if (callInterval) clearInterval(callInterval);
        synth.cancel();

        // *** AÇÃO DE SILENCIAR O VÍDEO DO YOUTUBE AQUI ***
        muteYouTubeVideo();

        setTimeout(() => {
            speak(announcementText);
            // Configura um intervalo para repetir a chamada
            callInterval = setInterval(() => {
                const el = chamadaPacienteDisplay ? chamadaPacienteDisplay.querySelector('span:first-child') : null;
                // Só repete se o paciente ainda estiver sendo exibido na tela de chamada
                if (el && el.textContent.toUpperCase() === patientName.toUpperCase()) {
                    speak(announcementText);
                } else {
                    clearInterval(callInterval); // Para de repetir se a chamada foi resolvida ou alterada
                }
            }, 30000); // Repete a cada 30 segundos
        }, 100); // Pequeno delay antes de iniciar a fala
    }

    // Atualiza a exibição de data e hora
    function updateDateTime() {
        const now = new Date();
        const optsDate = { year: 'numeric', month: '2-digit', day: '2-digit' };
        const optsTime = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
        if (dateTimeDisplay) {
            dateTimeDisplay.textContent = `${now.toLocaleDateString('pt-BR', optsDate)} ${now.toLocaleTimeString('pt-BR', optsTime)}`;
        }
    }
    setInterval(updateDateTime, 1000); // Atualiza a cada segundo
    updateDateTime(); // Chama uma vez para exibir imediatamente

    // Renderiza a lista de pacientes aguardando
    function renderWaitingList(list) {
        if (!waitingListDisplay) return;
        waitingListDisplay.innerHTML = ''; // Limpa a lista existente

        if (!Array.isArray(list) || list.length === 0) {
            waitingListDisplay.innerHTML = '<li>Nenhum paciente aguardando.</li>';
            return;
        }

        list.forEach(patient => {
            if (patient.status === 'waiting' || patient.status === 'called') {
                const item = document.createElement('li');

                // Adiciona o nome do paciente
                let textContent = patient.name;

                // Adiciona a informação do profissional, se disponível
                // ASSUMIMOS QUE 'patient.addedByProfessionalName' CONTÉM O NOME DO PROFISSIONAL
                if (patient.addedByProfessionalName) {
                    textContent += ` - Adicionado por: ${patient.addedByProfessionalName}`;
                }

                // Adiciona a indicação de prioridade
                if (patient.priority) {
                    textContent += ' (Prioridade)';
                }

                item.textContent = textContent;

                if (patient.priority) {
                    item.classList.add('priority');
                }
                waitingListDisplay.appendChild(item);
            }
        });
    }

    // --- Handlers de Eventos Socket.IO ---
    socket.on('initialData', (data) => {
        console.log('SALA_ESPERA (API YouTube v8 - Simplified Clear): Recebeu initialData', data);
        currentInitialData = data;
        if(data.waitingList) renderWaitingList(data.waitingList.filter(p => p.status === 'waiting' || p.status === 'called'));
        if (data.calledPatientInfo) announcePatient(data.calledPatientInfo.name, data.calledPatientInfo.calledBy);
        if (data.currentPlaylistUrl && data.currentPlaylistUrl !== "https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG") {
            if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
                loadYouTubeContent(data.currentPlaylistUrl);
            } else {
                lastValidPlaylistUrl = data.currentPlaylistUrl;
                console.log("SALA_ESPERA (API YouTube v8 - Simplified Clear): Player não pronto (initialData), URL pendente:", lastValidPlaylistUrl);
            }
        } else {
            if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
                ytPlayer.stopVideo();
            }
        }
    });

    socket.on('updateWaitingList', (list) => {
        console.log('SALA_ESPERA (API YouTube v8 - Simplified Clear): Recebeu updateWaitingList');
        renderWaitingList(list.filter(p => p.status === 'waiting' || p.status === 'called'));
    });

    socket.on('patientCalled', (patientInfo) => {
        console.log('SALA_ESPERA (API YouTube v8 - Simplified Clear): Recebeu patientCalled', patientInfo);
        // A função announcePatient já chama muteYouTubeVideo()
        if (patientInfo && patientInfo.name && patientInfo.calledBy) {
            announcePatient(patientInfo.name, patientInfo.calledBy);
        } else {
            console.warn("SALA_ESPERA: Recebeu patientCalled com dados incompletos:", patientInfo);
        }
    });

    socket.on('callResolved', () => {
        console.log('SALA_ESPERA (API YouTube v8 - Simplified Clear): Recebeu callResolved');
        if (callInterval) clearInterval(callInterval); // Para a repetição da chamada
        if(chamadaPacienteDisplay) chamadaPacienteDisplay.textContent = 'Aguardando chamada...';
        if (synth.speaking) synth.cancel(); // Cancela qualquer fala em andamento

        // *** AÇÃO DE RESTAURAR O VOLUME DO VÍDEO DO YOUTUBE AQUI ***
        // Adicionamos um pequeno atraso para que a fala da chamada termine antes do áudio do vídeo retornar
        setTimeout(() => {
            unmuteYouTubeVideoAndSetDefaultVolume();
        }, 2000); // Ajuste este tempo (em milissegundos) se o áudio da chamada for mais longo
    });

    socket.on('playlistUpdated', (playlistUrl) => {
        console.log('SALA_ESPERA (API YouTube v8 - Simplified Clear): Recebeu playlistUpdated', playlistUrl);
        if (playlistUrl && playlistUrl !== "https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG") {
            loadYouTubeContent(playlistUrl);
        } else {
            if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
                ytPlayer.stopVideo();
                const playerContainer = document.getElementById('youtubePlayer');
                if (playerContainer) playerContainer.innerHTML = ''; // Limpa o div do player
                console.log('SALA_ESPERA: URL da playlist vazia, parando e limpando vídeo.');
            }
        }
    });
});
