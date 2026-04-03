import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, RotateCcw, Volume2, AlertCircle, Trophy, Clock, FileText, ChevronRight, CheckCircle2, XCircle } from 'lucide-react';

// CHÚ Ý: ĐỂ TRỐNG Ở ĐÂY KHI CHẠY TRÊN CANVAS. 
// Khi deploy lên Vercel, anh hãy dùng: const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";

// --- UTILS: CSV Parser ---
const parseCSV = (text) => {
  const lines = text.split('\n').filter(line => line.trim() !== '');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = values[i];
    });
    return obj;
  });
};

// --- UTILS: PCM to WAV ---
const pcmToWav = (pcmData, sampleRate) => {
  const buffer = new ArrayBuffer(44 + pcmData.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 32 + pcmData.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcmData.length * 2, true);
  let offset = 44;
  for (let i = 0; i < pcmData.length; i++, offset += 2) view.setInt16(offset, pcmData[i], true);
  return buffer;
};

// --- UTILS: Auto Detect Language ---
const detectLang = (text) => {
  const viRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  return viRegex.test(text) ? 'vi' : 'en';
};

// --- UTILS: Sound Engine ---
let audioCtx = null;
const getAudioCtx = () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
};

const SoundEngine = {
  playTick: () => {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch (e) {}
  },
  playTing: () => {
    try {
      const ctx = getAudioCtx();
      const playNote = (freq, delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        gain.gain.setValueAtTime(0.1, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.4);
      };
      playNote(1046.50, 0); 
      playNote(1318.51, 0.15); 
    } catch(e) {}
  },
  playWrong: () => {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch(e) {}
  },
  playApplause: () => {
    const audio = new Audio('https://actions.google.com/sounds/v1/crowds/light_applause.ogg');
    audio.volume = 0.4;
    audio.play().catch(e => console.log('Audio play blocked', e));
  }
};

// --- UTILS: Fallback TTS (Offline Web Speech API) ---
const fallbackSpeak = (text, lang, onEnd) => {
  if (!('speechSynthesis' in window)) {
    if (onEnd) onEnd();
    return;
  }
  
  window.speechSynthesis.cancel(); 
  
  const utterance = new SpeechSynthesisUtterance(text);
  const targetLang = lang === 'en' ? 'en-US' : 'vi-VN';
  utterance.lang = targetLang;
  utterance.rate = 1.0;
  
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    const targetVoice = voices.find(v => v.lang.toLowerCase().includes(lang === 'en' ? 'en' : 'vi'));
    if (targetVoice) utterance.voice = targetVoice;
  }
  
  let isEnded = false;
  const safeEnd = () => {
    if (isEnded) return;
    isEnded = true;
    if (onEnd) onEnd();
  };

  utterance.onend = safeEnd;
  utterance.onerror = safeEnd; 
  
  window.speechSynthesis.speak(utterance);

  const estimatedTime = text.length * 150 + 3000;
  setTimeout(safeEnd, estimatedTime);
};

const App = () => {
  const [gameState, setGameState] = useState('config'); 
  const [questions, setQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(10);
  const [csvUrl, setCsvUrl] = useState('https://docs.google.com/spreadsheets/d/1qMTFOHUOuK-J1gnS4sCmsh-N7A8ucgWKc0opDNPhdqE/edit?gid=0#gid=0');
  const [error, setError] = useState(null);
  const [playerName, setPlayerName] = useState('Mỹ An'); 
  
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hasRead, setHasRead] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [isRevealing, setIsRevealing] = useState(false);
  
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const audioCacheRef = useRef({}); 

  // Xây dựng nội dung kịch bản đọc đầy đủ (để dùng chung cho cả Gemini và Fallback)
  const getQuestionScript = (q) => {
    if (!q) return "";
    const lang = detectLang(q.question);
    const options = lang === 'en' 
      ? `Option A is: ${q.a}. Option B is: ${q.b}. Option C is: ${q.c}.`
      : `Đáp án A là: ${q.a}. Đáp án B là: ${q.b}. Đáp án C là: ${q.c}.`;
    
    const content = `${q.question}. ${options}`;
    
    if (lang === 'en') {
      return `${content} I will read it again. ${content} 10 seconds to answer starts now.`;
    } else {
      return `${content} Cô đọc lại lần nữa. ${content} 10 giây để trả lời bắt đầu.`;
    }
  };

  const fetchTTS = async (text, isQuestion = true) => {
    const lang = detectLang(text);
    const voiceName = lang === 'en' ? "Kore" : "Aoede";
    
    // Prompt của Gemini sẽ chỉ yêu cầu nói đúng văn bản script đã được chuẩn bị
    const prompt = isQuestion
      ? (lang === 'en' 
          ? `Speak in an American female voice exactly as follows: ${text}`
          : `Nói bằng giọng nữ chuẩn miền Bắc chính xác đoạn sau: ${text}`)
      : (lang === 'en' 
          ? `Speak cheerfully: ${text}` 
          : `Nói vui tươi: ${text}`);

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
        },
        model: "gemini-2.5-flash-preview-tts"
      })
    });

    if (!response.ok) throw new Error("TTS fetch failed");

    const result = await response.json();
    const pcmBase64 = result.candidates[0].content.parts[0].inlineData.data;
    const mimeType = result.candidates[0].content.parts[0].inlineData.mimeType;
    const sampleRate = parseInt(mimeType.match(/sample_rate=(\d+)/)?.[1] || "24000");
    
    const binaryString = atob(pcmBase64);
    const len = binaryString.length;
    const bytes = new Int16Array(len / 2);
    for (let i = 0; i < len; i += 2) {
      bytes[i / 2] = (binaryString.charCodeAt(i + 1) << 8) | binaryString.charCodeAt(i);
    }

    const wavBuffer = pcmToWav(bytes, sampleRate);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  };

  const preloadQuestion = async (index, qData) => {
    if (!qData || index >= qData.length || audioCacheRef.current[index]) return; 
    
    try {
      const script = getQuestionScript(qData[index]);
      const url = await fetchTTS(script, true);
      audioCacheRef.current[index] = url;

      await new Promise(res => setTimeout(res, 800));

      const correctAns = qData[index].answer.trim().toUpperCase();
      const correctText = qData[index][correctAns.toLowerCase()];
      const lang = detectLang(qData[index].question);
      const revealText = lang === 'en'
        ? `The correct answer is ${correctAns}, ${correctText}`
        : `Đáp án đúng là ${correctAns}, ${correctText}`;
      const revealUrl = await fetchTTS(revealText, false);
      audioCacheRef.current[`reveal_${index}`] = revealUrl;
    } catch (e) {
      console.warn(`Preload skipped for ${index}`, e);
      audioCacheRef.current[index] = 'FALLBACK';
      audioCacheRef.current[`reveal_${index}`] = 'FALLBACK';
    }
  };

  const playQuestionAudio = async (index) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    setHasRead(false);
    
    const script = getQuestionScript(questions[index]);
    const lang = detectLang(questions[index].question);

    const runFallback = () => {
      fallbackSpeak(script, lang, () => {
        setIsSpeaking(false);
        setHasRead(true);
        preloadQuestion(index + 1, questions);
      });
    };

    try {
      let url = audioCacheRef.current[index];
      if (!url || url === 'FALLBACK') {
        url = await fetchTTS(script, true);
        audioCacheRef.current[index] = url;
      }
      
      if (audioRef.current && url !== 'FALLBACK') {
        audioRef.current.src = url;
        audioRef.current.onended = () => {
          setIsSpeaking(false);
          setHasRead(true);
          preloadQuestion(index + 1, questions);
        };
        audioRef.current.onerror = runFallback;
        audioRef.current.play().catch(runFallback);
      } else {
        runFallback();
      }
    } catch (err) {
      runFallback();
    }
  };

  const playMessageAudio = async (text) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    const lang = detectLang(text);
    const runFallback = () => fallbackSpeak(text, lang, () => setIsSpeaking(false));

    try {
      const url = await fetchTTS(text, false);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.onended = () => setIsSpeaking(false);
        audioRef.current.onerror = runFallback;
        audioRef.current.play().catch(runFallback);
      } else {
        runFallback();
      }
    } catch (err) {
      runFallback();
    }
  };

  const loadQuestions = async () => {
    try {
      getAudioCtx();
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        // Mồi cho iOS nạp voices sớm
        window.speechSynthesis.getVoices(); 
        const init = new SpeechSynthesisUtterance(' ');
        init.volume = 0;
        window.speechSynthesis.speak(init);
      }
    } catch(e) {}

    if (!csvUrl) {
      setError("Vui lòng nhập link CSV.");
      return;
    }
    setGameState('loading');
    setError(null);
    try {
      let fetchUrl = csvUrl;
      if (csvUrl.includes('docs.google.com/spreadsheets/d/')) {
        const idMatch = csvUrl.match(/\/d\/(.+?)\//);
        if (idMatch) fetchUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv`;
      }
      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error("File không công khai.");
      const text = await response.text();
      let data = parseCSV(text);
      if (data.length === 0) throw new Error("CSV trống.");
      
      for (let i = data.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [data[i], data[j]] = [data[j], data[i]];
      }

      data = data.map(q => {
        const origAns = (q.answer || '').trim().toLowerCase();
        const correctText = q[origAns]; 
        let options = [q.a, q.b, q.c];
        for (let i = 2; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [options[i], options[j]] = [options[j], options[i]];
        }
        return {
          ...q, a: options[0], b: options[1], c: options[2],
          answer: ['A', 'B', 'C'][options.indexOf(correctText)]
        };
      });

      audioCacheRef.current = {};
      await preloadQuestion(0, data);
      setQuestions(data);
      setGameState('playing');
      setCurrentIdx(0);
      setScore(0);
      setTimeLeft(10);
      setHasRead(false);
    } catch (err) {
      setError(err.message);
      setGameState('config');
    }
  };

  useEffect(() => {
    if (gameState === 'playing' && hasRead && !isRevealing) {
      if (timeLeft > 0) {
        timerRef.current = setTimeout(() => {
          SoundEngine.playTick();
          setTimeLeft(prev => prev - 1);
        }, 1000);
      } else {
        SoundEngine.playTing();
        handleAnswer(null); 
      }
    }
    return () => clearTimeout(timerRef.current);
  }, [gameState, timeLeft, hasRead, isRevealing]);

  useEffect(() => {
    if (gameState === 'playing' && questions[currentIdx]) {
      playQuestionAudio(currentIdx);
    }
  }, [currentIdx, gameState]);

  useEffect(() => {
    if (gameState === 'gameover' || gameState === 'win') {
      const name = playerName.trim() || 'bạn';
      let msg = `Chúc mừng ${name}, bạn đã đạt được ${score} điểm.`;
      if (gameState === 'gameover') msg += ` ${name} cố gắng hơn lần sau nhé.`;
      playMessageAudio(msg);
    }
  }, [gameState, score, playerName]);

  const handleAnswer = async (choice) => {
    if (isRevealing) return;
    if (audioRef.current) audioRef.current.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    clearTimeout(timerRef.current);
    setSelectedChoice(choice);
    setIsRevealing(true);
    
    const correct = questions[currentIdx].answer.trim().toUpperCase();
    const isCorrect = choice === correct;
    isCorrect ? SoundEngine.playApplause() : SoundEngine.playWrong();

    setIsSpeaking(true);
    const correctText = questions[currentIdx][correct.toLowerCase()];
    const lang = detectLang(questions[currentIdx].question);
    const revealText = lang === 'en' ? `Correct answer is ${correct}, ${correctText}` : `Đáp án đúng là ${correct}, ${correctText}`;
    
    const runRevealFallback = () => new Promise(res => fallbackSpeak(revealText, lang, res));

    try {
      let revealUrl = audioCacheRef.current[`reveal_${currentIdx}`];
      if (!revealUrl || revealUrl === 'FALLBACK') {
        revealUrl = await fetchTTS(revealText, false);
      }
      
      if (revealUrl && revealUrl !== 'FALLBACK' && audioRef.current) {
        await new Promise(res => {
          // FIX LỖI TYPO: Phải là revealUrl chứ không phải url
          audioRef.current.src = revealUrl;
          audioRef.current.onended = res;
          audioRef.current.onerror = res;
          audioRef.current.play().catch(res);
        });
      } else {
        await runRevealFallback();
      }
    } catch (e) {
      await runRevealFallback();
    }

    setIsSpeaking(false);
    await new Promise(res => setTimeout(res, 500));
    setIsRevealing(false);
    setSelectedChoice(null);
    setHasRead(false);

    if (isCorrect) {
      const nextScore = score + 1;
      if (currentIdx + 1 < questions.length) {
        setScore(nextScore);
        setCurrentIdx(i => i + 1);
        setTimeLeft(10);
      } else {
        setScore(nextScore);
        setGameState('win');
      }
    } else {
      setGameState('gameover');
    }
  };

  const resetGame = () => {
    if (audioRef.current) audioRef.current.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setGameState('config');
    setQuestions([]);
    setCurrentIdx(0);
    setScore(0);
    setTimeLeft(10);
    setSelectedChoice(null);
    setIsRevealing(false);
    setHasRead(false);
  };

  const getChoiceStyle = (label) => {
    const correct = questions[currentIdx]?.answer;
    if (!isRevealing) return "border-slate-100 bg-white active:bg-amber-50";
    if (label === correct) return "border-green-500 bg-green-50 ring-2 ring-green-200";
    if (selectedChoice === label) return "border-red-500 bg-red-50 ring-2 ring-red-200";
    return "opacity-50 border-slate-100";
  };

  return (
    <div className="min-h-[100dvh] bg-amber-50 flex items-center justify-center p-2 font-sans text-slate-800">
      <audio ref={audioRef} hidden playsInline />
      <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl overflow-hidden border-4 border-amber-400">
        <div className="bg-amber-400 p-6 flex justify-between items-center text-white">
          <div className="flex items-center gap-3">
            <Trophy className="w-8 h-8" />
            <h1 className="text-2xl font-black uppercase">Rung Chuông Vàng</h1>
          </div>
          {gameState === 'playing' && <div className="text-right text-xs font-bold">Câu: {currentIdx + 1}/{questions.length}<br/>Điểm: {score}</div>}
        </div>

        <div className="p-6">
          {gameState === 'config' && (
            <div className="space-y-6 text-center">
              <FileText className="mx-auto text-amber-500 w-16 h-16" />
              <h2 className="text-xl font-bold">Cấu hình ván chơi</h2>
              <input type="text" value={playerName} onChange={e => setPlayerName(e.target.value)} placeholder="Tên bé..." className="w-full p-4 rounded-xl border-2 outline-none focus:border-amber-400" />
              <input type="text" value={csvUrl} onChange={e => setCsvUrl(e.target.value)} placeholder="Link Google Drive..." className="w-full p-4 rounded-xl border-2 outline-none focus:border-amber-400" />
              {error && <p className="text-red-500 text-sm italic">{error}</p>}
              <button onClick={loadQuestions} className="w-full bg-amber-500 text-white font-bold py-4 rounded-xl shadow-lg active:scale-95 transition-all">Bắt đầu ngay</button>
            </div>
          )}

          {gameState === 'loading' && <div className="py-20 text-center animate-pulse font-bold text-amber-600">Đang chuẩn bị câu hỏi...</div>}

          {gameState === 'playing' && (
            <div className="space-y-6">
              <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full transition-all duration-1000 ease-linear ${timeLeft <= 3 ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${(timeLeft / 10) * 100}%` }} />
              </div>
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex justify-between items-start gap-4">
                <h3 className="text-xl font-bold leading-tight">{questions[currentIdx]?.question}</h3>
                <button onClick={() => playQuestionAudio(currentIdx)} disabled={isSpeaking || isRevealing} className={`p-3 rounded-full ${isSpeaking ? 'bg-amber-100 text-amber-400' : 'bg-amber-500 text-white'}`}><Volume2 /></button>
              </div>
              <div className="grid gap-3">
                {['A', 'B', 'C'].map(label => (
                  <button key={label} disabled={isRevealing || !hasRead} onClick={() => handleAnswer(label)} style={{ WebkitTapHighlightColor: 'transparent' }} className={`w-full p-4 text-left border-2 rounded-2xl transition-all flex items-center gap-4 ${getChoiceStyle(label)}`}>
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${isRevealing && label === questions[currentIdx].answer ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{label}</span>
                    <span className="font-medium">{questions[currentIdx]?.[label.toLowerCase()]}</span>
                    {isRevealing && label === questions[currentIdx].answer && <CheckCircle2 className="ml-auto text-green-500" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(gameState === 'gameover' || gameState === 'win') && (
            <div className="py-10 text-center space-y-6">
              <div className="text-6xl">{gameState === 'win' ? '🎊' : '🔔'}</div>
              <h2 className="text-3xl font-black uppercase">{gameState === 'win' ? 'Chiến thắng!' : 'Dừng chân rồi!'}</h2>
              <div className="text-5xl font-black text-amber-500">{score} điểm</div>
              <button onClick={resetGame} className="bg-amber-500 text-white font-bold px-10 py-4 rounded-2xl shadow-lg active:scale-95 transition-all">Chơi ván mới</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;