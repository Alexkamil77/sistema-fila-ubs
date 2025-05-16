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

    function onPlayerReady(event) {
        console.log('SALA_ESPERA: >>> YouTube Player Ready. <<<');
        if (event && event.target && typeof event.target.setVolume === 'function') {
            event.target.setVolume(50);
            console.log('SALA_ESPERA: Volume do player do YouTube definido para 50.');
        }
        let urlToLoad = null;
        if (lastValidPlaylistUrl) { 
            urlToLoad = lastValidPlaylistUrl;
            console.log('SALA_ESPERA (onPlayerReady): Carregando URL pendente de lastValidPlaylistUrl:', urlToLoad);
        } else if (currentInitialData && currentInitialData.currentPlaylistUrl && currentInitialData.currentPlaylistUrl !== "https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG") {
            urlToLoad = currentInitialData.currentPlaylistUrl;
            console.log('SALA_ESPERA (onPlayerReady): Carregando URL pendente de initialData:', urlToLoad);
        }
        if (urlToLoad) { loadYouTubeContent(urlToLoad); }
        else { console.log('SALA_ESPERA (onPlayerReady): Nenhuma URL pendente para carregar.'); }
    }

    function onPlayerStateChange(event) {
        console.log('SALA_ESPERA: YouTube Player State Change:', event.data, '(Estado Atual)');
        if (event.data === YT.PlayerState.PLAYING) {
            if (ytPlayer && typeof ytPlayer.setVolume === 'function') ytPlayer.setVolume(50); 
        }
        if (event.data === YT.PlayerState.ENDED) {
            console.log('SALA_ESPERA: Vídeo/Playlist terminou. Loop é geralmente tratado por params da URL/playerVars.');
        }
    }
    function onPlayerError(event) {
        console.error('SALA_ESPERA: Erro no Player do YouTube:', event.data, 'Para URL:', lastValidPlaylistUrl);
        const playerContainer = document.getElementById('youtubePlayer');
        let errorMessage = 'Erro ao carregar vídeo.';
        if (event.data === 2) errorMessage = 'URL do vídeo/playlist parece inválida.';
        if (event.data === 5) errorMessage = 'Conteúdo não pode ser reproduzido (erro HTML5).';
        if (event.data === 100) errorMessage = 'Vídeo não encontrado (removido ou privado).';
        if (event.data === 101 || event.data === 150) errorMessage = 'Incorporação não permitida pelo proprietário.';
        if (playerContainer) playerContainer.innerHTML = `<p style="color:white; text-align:center; padding-top: 20%; font-size:1.2em;">${errorMessage}</p>`;
    }

    window.onYouTubeIframeAPIReady = function() {
        console.log('SALA_ESPERA: >>> YouTube Iframe API Ready. <<<');
        try {
            ytPlayer = new YT.Player('youtubePlayer', {
                height: '100%', width: '100%',
                playerVars: { 'autoplay': 1, 'controls': 0, 'loop': 1, 'playsinline': 1, 'origin': window.location.origin, 'iv_load_policy': 3, 'modestbranding': 1, 'rel': 0 },
                events: { 'onReady': onPlayerReady, 'onStateChange': onPlayerStateChange, 'onError': onPlayerError }
            });
        } catch (e) { console.error("SALA_ESPERA: Erro ao tentar criar YT.Player:", e); }
    };
    
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api"; 
    const firstScriptTag = document.getElementsByTagName('script')[0];
    if (firstScriptTag && firstScriptTag.parentNode) firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    else document.head.appendChild(tag);

    function loadYouTubeContent(playlistUrlToLoad) {
        if (!ytPlayer || typeof ytPlayer.loadVideoById !== 'function') {
            console.warn("SALA_ESPERA (loadYouTubeContent): ytPlayer não está pronto, URL continua pendente:", playlistUrlToLoad);
            lastValidPlaylistUrl = playlistUrlToLoad; return;
        }
        console.log('SALA_ESPERA (loadYouTubeContent): Processando URL:', playlistUrlToLoad);
        lastValidPlaylistUrl = playlistUrlToLoad; 
        let videoId = ''; let playlistId = ''; let startSeconds = 0; let isPlaylist = false;

        try {
            let tempUrl = playlistUrlToLoad;
            if (!tempUrl.startsWith('http://') && !tempUrl.startsWith('https://')) {
                if (!tempUrl.startsWith('//')) tempUrl = '//' + tempUrl;
                if (!tempUrl.startsWith('https://')) tempUrl = 'https:' + tempUrl;
            }
            const urlObj = new URL(tempUrl);
            console.log("SALA_ESPERA (loadYouTubeContent): Objeto URL criado. Pathname:", urlObj.pathname, "Search:", urlObj.search);

            let extractedListParam = urlObj.searchParams.get('list');
            console.log("SALA_ESPERA (loadYouTubeContent DEBUG): Valor de urlObj.searchParams.get('list') É:", extractedListParam);
            
            if (extractedListParam && typeof extractedListParam === 'string' && extractedListParam.trim() !== '') { 
                playlistId = extractedListParam;
                isPlaylist = true;
                console.log("SALA_ESPERA (loadYouTubeContent): ID da Playlist (de urlObj.searchParams.get):", playlistId);
            } else {
                console.log("SALA_ESPERA (loadYouTubeContent DEBUG): urlObj.searchParams.get('list') falhou. Tentando fallback manual de string em urlObj.search:", urlObj.search);
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
                        console.log("SALA_ESPERA (loadYouTubeContent): ID da Playlist (de FALLBACK MANUAL string indexOf):", playlistId);
                    } else {
                        console.warn("SALA_ESPERA (loadYouTubeContent DEBUG): Fallback manual encontrou 'list=' mas não conseguiu extrair valor.");
                    }
                } else {
                    console.warn("SALA_ESPERA (loadYouTubeContent DEBUG): Fallback manual não encontrou 'list=' em urlObj.search.");
                    if (urlObj.pathname.includes('/embed/')) {
                        const pathSegments = urlObj.pathname.split('/');
                        const potentialId = pathSegments[pathSegments.length - 1];
                        if (potentialId && potentialId.toLowerCase() !== 'videoseries' && potentialId.length === 11) {
                            videoId = potentialId;
                            console.log("SALA_ESPERA (loadYouTubeContent): ID do Vídeo (de /embed/, não 'videoseries'):", videoId);
                        } else if (potentialId && potentialId.toLowerCase() === 'videoseries') {
                             console.warn("SALA_ESPERA (loadYouTubeContent): URL é /embed/videoseries mas 'list' param não foi pego por nenhum método.");
                        }
                    }
                }
            }
            
            const timeParam = urlObj.searchParams.get('t') || urlObj.searchParams.get('start');
            if (timeParam) { /* ... (código de parse de tempo como antes) ... */ }

        } catch (e) { /* ... (bloco catch como antes) ... */ }
        
        const playerContainer = document.getElementById('youtubePlayer');
        // *** MUDANÇA AQUI: Simplificando a limpeza do playerContainer ***
        if (playerContainer && playerContainer.firstChild && playerContainer.firstChild.tagName === 'P') {
            console.log("SALA_ESPERA (loadYouTubeContent): Limpando mensagem de erro anterior do playerContainer.");
            playerContainer.innerHTML = ''; 
            // REMOVIDO: player.destroy(), window.onYouTubeIframeAPIReady() e o return;
        }
        // *** FIM DA MUDANÇA ***

        if (ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo();

        if (isPlaylist && playlistId) {
            console.log('SALA_ESPERA (loadYouTubeContent): Carregando PLAYLIST com ID:', playlistId, 'index: 0, startSeconds:', startSeconds || 0);
            ytPlayer.loadPlaylist({ list: playlistId, listType: 'playlist', index: 0, startSeconds: startSeconds || 0 });
        } else if (videoId) {
            console.log('SALA_ESPERA (loadYouTubeContent): Carregando VÍDEO com ID:', videoId, 'em', startSeconds || 0, 's');
            ytPlayer.loadVideoById({videoId: videoId, startSeconds: startSeconds || 0});
        } else {
            console.warn('SALA_ESPERA (loadYouTubeContent): FINAL: Não foi possível extrair um ID de vídeo ou playlist válido da URL:', playlistUrlToLoad);
            if(playerContainer) playerContainer.innerHTML = '<p style="color:white; text-align:center; padding-top: 20%; font-size:1.2em;">URL do vídeo/playlist inválida ou não reconhecida.</p>';
        }
    }

    // --- Funções de Controle de Áudio e UI (COPIE O RESTANTE DO SEU CÓDIGO A PARTIR DAQUI) ---
    // Certifique-se de que as funções:
    // if (activateSoundButton) { ... }
    // function loadVoices() { ... } e sua chamada loadVoices();
    // function speak(text) { ... }
    // function announcePatient(patientName, professionalName, forceSpeak = false) { ... }
    // function updateDateTime() { ... } e seu setInterval e chamada inicial.
    // function renderWaitingList(list) { ... }
    // E TODOS os seus handlers socket.on('initialData', 'updateWaitingList', 'patientCalled', 'callResolved', 'playlistUpdated')
    // ESTEJAM PRESENTES AQUI, como na última versão completa que te enviei.
    // Atualize os logs neles para "API YouTube v8 - Simplified Clear" para rastreio.

    // COLE O RESTANTE DO CÓDIGO (funções e socket handlers) AQUI:
    if (activateSoundButton) {
        activateSoundButton.addEventListener('click', () => {
            audioActivated = true; if (synth.paused) synth.resume();
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
            synth.speak(testUtterance); activateSoundButton.classList.add('hidden');
            console.log('SALA_ESPERA: Interação para áudio.');
        });
    }
    function loadVoices() { 
        const voices = synth.getVoices();
        femaleVoice = voices.find(v => v.lang === 'pt-BR' && v.name.toLowerCase().includes('female')) || voices.find(v => v.lang === 'pt-BR');
        if (!femaleVoice && voices.length === 0 && speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = () => {
                speechSynthesis.onvoiceschanged = null;
                const updatedVoices = synth.getVoices();
                femaleVoice = updatedVoices.find(v => v.lang === 'pt-BR' && v.name.toLowerCase().includes('female')) || updatedVoices.find(v => v.lang === 'pt-BR');
                console.log(femaleVoice ? `Voz PT-BR (onchange): ${femaleVoice.name}` : "Nenhuma voz PT-BR feminina (onchange).");
            };
        } else { console.log(femaleVoice ? `Voz PT-BR inicial: ${femaleVoice.name}` : "Nenhuma voz PT-BR feminina inicial."); }
    }
    loadVoices();
    function speak(text) {
        if (!audioActivated && activateSoundButton && !activateSoundButton.classList.contains('hidden')) {
            activateSoundButton.classList.add('highlight-needed'); return;
        }
        if (activateSoundButton) activateSoundButton.classList.remove('highlight-needed');
        if (synth.speaking) { synth.cancel(); setTimeout(() => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'pt-BR'; if (femaleVoice) utterance.voice = femaleVoice;
            utterance.pitch = 1; utterance.rate = 1; utterance.volume = 1;
            utterance.onerror = (e) => console.error('SALA_ESPERA: Erro Speech API (speak):', e.error);
            synth.speak(utterance);
        }, 50); return; }
        if (text) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'pt-BR'; if (femaleVoice) utterance.voice = femaleVoice;
            utterance.pitch = 1; utterance.rate = 1; utterance.volume = 1;
            utterance.onerror = (e) => console.error('SALA_ESPERA: Erro Speech API (speak):', e.error);
            synth.speak(utterance);
        }
    }
    function announcePatient(patientName, professionalName, forceSpeak = false) {
        if (!audioActivated && !forceSpeak && activateSoundButton && !activateSoundButton.classList.contains('hidden')) {
            if (chamadaPacienteDisplay) {
                chamadaPacienteDisplay.dataset.currentPatientName = patientName;
                chamadaPacienteDisplay.dataset.currentCalledBy = professionalName;
                chamadaPacienteDisplay.innerHTML = `<span>${patientName.toUpperCase()}</span><span class="sala">Consultório: ${professionalName} <br>(Som desativado)</span>`;
            }
            if(activateSoundButton) activateSoundButton.classList.add('highlight-needed'); return;
        }
        if (activateSoundButton) activateSoundButton.classList.remove('highlight-needed');
        if(chamadaPacienteDisplay) { delete chamadaPacienteDisplay.dataset.currentPatientName; delete chamadaPacienteDisplay.dataset.currentCalledBy; }
        const announcementText = `Paciente ${patientName}, por favor, dirija-se ao consultório de ${professionalName}.`;
        if(chamadaPacienteDisplay) chamadaPacienteDisplay.innerHTML = `<span>${patientName.toUpperCase()}</span><span class="sala">Consultório: ${professionalName}</span>`;
        if (callInterval) clearInterval(callInterval); synth.cancel(); 
        setTimeout(() => {
            speak(announcementText);
            callInterval = setInterval(() => {
                const el = chamadaPacienteDisplay ? chamadaPacienteDisplay.querySelector('span:first-child') : null;
                if (el && el.textContent.toUpperCase() === patientName.toUpperCase()) speak(announcementText);
                else clearInterval(callInterval);
            }, 30000);
        }, 100);
    }
    function updateDateTime() {
        const now = new Date();
        const optsDate = { year: 'numeric', month: '2-digit', day: '2-digit' };
        const optsTime = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
        if (dateTimeDisplay) dateTimeDisplay.textContent = `${now.toLocaleDateString('pt-BR', optsDate)} ${now.toLocaleTimeString('pt-BR', optsTime)}`;
    }
    setInterval(updateDateTime, 1000); updateDateTime();
    function renderWaitingList(list) {
        if (!waitingListDisplay) return; waitingListDisplay.innerHTML = '';
        if (!Array.isArray(list) || list.length === 0) {
            waitingListDisplay.innerHTML = '<li>Nenhum paciente aguardando.</li>'; return;
        }
        list.forEach(patient => {
            if (patient.status === 'waiting' || patient.status === 'called') {
                const item = document.createElement('li');
                item.textContent = `${patient.name} ${patient.priority ? '(Prioridade)' : ''}`;
                if (patient.priority) item.classList.add('priority');
                waitingListDisplay.appendChild(item);
            }
        });
    }
    
    // --- Handlers de Eventos Socket.IO ---
    // Logs atualizados para v8 para fácil identificação
    socket.on('initialData', (data) => {
        console.log('SALA_ESPERA (API YouTube v8 - Simplified Clear): Recebeu initialData', data);
        currentInitialData = data; 
        if(data.waitingList) renderWaitingList(data.waitingList.filter(p => p.status === 'waiting' || p.status === 'called'));
        if (data.calledPatientInfo) announcePatient(data.calledPatientInfo.name, data.calledPatientInfo.calledBy);
        if (data.currentPlaylistUrl && data.currentPlaylistUrl !== "https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG") {
            if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') loadYouTubeContent(data.currentPlaylistUrl);
            else {
                lastValidPlaylistUrl = data.currentPlaylistUrl; 
                console.log("SALA_ESPERA (API YouTube v8 - Simplified Clear): Player não pronto (initialData), URL pendente:", lastValidPlaylistUrl);
            }
        } else { if (ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo(); }
    });
    socket.on('updateWaitingList', (list) => { 
        console.log('SALA_ESPERA (API YouTube v8 - Simplified Clear): Recebeu updateWaitingList');
        renderWaitingList(list.filter(p => p.status === 'waiting' || p.status === 'called'));
    });
    socket.on('patientCalled', (patientInfo) => { 
        console.log('SALA_ESPERA (API YouTube v8 - Simplified Clear): Recebeu patientCalled', patientInfo);
        if (patientInfo && patientInfo.name && patientInfo.calledBy) announcePatient(patientInfo.name, patientInfo.calledBy);
        else console.warn("SALA_ESPERA: Recebeu patientCalled com dados incompletos:", patientInfo);
    });
    socket.on('callResolved', () => {  
        console.log('SALA_ESPERA (API YouTube v8 - Simplified Clear): Recebeu callResolved');
        if (callInterval) clearInterval(callInterval);
        if(chamadaPacienteDisplay) chamadaPacienteDisplay.textContent = 'Aguardando chamada...';
        if (synth.speaking) synth.cancel();
    });
    socket.on('playlistUpdated', (playlistUrl) => { 
        console.log('SALA_ESPERA (API YouTube v8 - Simplified Clear): Recebeu playlistUpdated', playlistUrl); 
        if (playlistUrl && playlistUrl !== "https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG") loadYouTubeContent(playlistUrl);
        else { 
            if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
                ytPlayer.stopVideo();
                const playerContainer = document.getElementById('youtubePlayer');
                if (playerContainer) playerContainer.innerHTML = ''; // Limpa o div do player
                console.log('SALA_ESPERA: URL da playlist vazia, parando e limpando vídeo.');
            }
        }
    });
});