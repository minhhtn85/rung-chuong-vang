import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, RotateCcw, Volume2, AlertCircle, Trophy, Clock, FileText, ChevronRight, CheckCircle2, XCircle } from 'lucide-react';

// ĐỂ TRỐNG Ở ĐÂY KHI CHẠY TRÊN CANVAS. 
// LƯU Ý BẢO MẬT: Khi deploy lên Vercel, TUYỆT ĐỐI KHÔNG commit key thẳng vào file này lên Github.
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

// --- UTILS: Sound Engine (Web Audio API & HTML Audio) ---
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
      gain.gain.setValueAtTime(0.02, ctx.currentTime);
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
        gain.gain.setValueAtTime(0.2, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.4);
      };
      playNote(1046.50, 0); // C6
      playNote(1318.51, 0.15); // E6
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
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch(e) {}
  },
  playApplause: () => {
    const audio = new Audio('https://actions.google.com/sounds/v1/crowds/light_applause.ogg');
    audio.volume = 0.5;
    audio.play().catch(e => console.log('Audio play failed', e));
  }
};

// --- UTILS: Fallback TTS (Offline Web Speech API) ---
const fallbackSpeak = (text, lang, onEnd) => {
  if (!('speechSynthesis' in window)) {
    if (onEnd) onEnd();
    return;
  }
  window.speechSynthesis.cancel(); // Dừng các luồng đang đọc
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'en' ? 'en-US' : 'vi-VN';
  utterance.rate = 1.0;
  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd; // Tiến hành tiếp game dù có lỗi
  }
  window.speechSynthesis.speak(utterance);
};

const App = () => {
  const [gameState, setGameState] = useState('config'); // config, loading, playing, gameover, win
  const [questions, setQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(10);
  const [csvUrl, setCsvUrl] = useState('https://docs.google.com/spreadsheets/d/1qMTFOHUOuK-J1gnS4sCmsh-N7A8ucgWKc0opDNPhdqE/edit?gid=0#gid=0');
  const [error, setError] = useState(null);
  const [playerName, setPlayerName] = useState('Mỹ An'); 
  
  // New States for logic updates
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hasRead, setHasRead] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [isRevealing, setIsRevealing] = useState(false);
  
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const audioCacheRef = useRef({}); 

  // Helper để lấy chuỗi đọc bao gồm cả đáp án
  const getFullQuestionText = (q) => {
    if (!q) return "";
    const lang = detectLang(q.question);
    if (lang === 'en') {
      return `${q.question}. Option A is: ${q.a}. Option B is: ${q.b}. Option C is: ${q.c}.`;
    } else {
      return `${q.question}. Đáp án A là: ${q.a}. Đáp án B là: ${q.b}. Đáp án C là: ${q.c}.`;
    }
  };

  // Hàm tải TTS độc lập, trả về URL của file audio
  const fetchTTS = async (text, isQuestion = true) => {
    const lang = detectLang(text);
    const voiceName = lang === 'en' ? "Kore" : "Aoede";
    
    let prompt = "";
    if (isQuestion) {
      if (lang === 'en') {
        prompt = `Speak in an American female voice: ${text}. I will read it again. ${text}. 10 seconds to answer starts now.`;
      } else {
        prompt = `Nói bằng giọng nữ chuẩn miền Bắc: ${text}. Cô đọc lại lần nữa. ${text}. 10 giây để trả lời bắt đầu.`;
      }
    } else {
      if (lang === 'en') {
        prompt = `Speak cheerfully in an American female voice: ${text}`;
      } else {
        prompt = `Nói vui tươi bằng giọng nữ chuẩn miền Bắc: ${text}`;
      }
    }

    let retryCount = 0;
    const maxRetries = 3; // Giảm số lần retry để tránh giam ứng dụng quá lâu khi bị rate limit
    let response;

    while (retryCount < maxRetries) {
      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
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
        if (response.ok) break;
        const errText = await response.text();
        console.error("API Error Details:", errText);
        if (response.status === 403 || response.status === 429) {
          throw new Error(`API quota/permission error: ${response.status}`);
        }
      } catch (e) {
        console.error("Network/Fetch Error:", e);
        if (e.message.includes("quota/permission")) throw e; // Dừng retry nếu là lỗi khóa key hoặc hết quota
      }
      retryCount++;
      await new Promise(res => setTimeout(res, Math.pow(2, retryCount) * 1000));
    }

    if (!response || !response.ok) throw new Error("TTS fetch failed or rejected");

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

  // Tải trước audio cho một câu hỏi
  const preloadQuestion = async (index, qData) => {
    if (!qData || index >= qData.length) return;
    if (audioCacheRef.current[index]) return; 
    
    try {
      const fullText = getFullQuestionText(qData[index]);
      const url = await fetchTTS(fullText, true);
      audioCacheRef.current[index] = url;

      // Cố tình delay 1 chút trước khi tải đáp án để tránh dồn Request (Tránh 429 Error)
      await new Promise(res => setTimeout(res, 1000));

      const correctAns = qData[index].answer.trim().toUpperCase();
      const correctText = qData[index][correctAns.toLowerCase()];
      const lang = detectLang(qData[index].question);
      const revealText = lang === 'en'
        ? `The correct answer is ${correctAns}, ${correctText}`
        : `Đáp án đúng là ${correctAns}, ${correctText}`;
      const revealUrl = await fetchTTS(revealText, false);
      audioCacheRef.current[`reveal_${index}`] = revealUrl;
    } catch (e) {
      console.warn(`[Fallback Mode] Preload skipped for question ${index}`, e);
      audioCacheRef.current[index] = 'FALLBACK';
      audioCacheRef.current[`reveal_${index}`] = 'FALLBACK';
    }
  };

  const playQuestionAudio = async (index) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    setHasRead(false);
    
    const fullText = getFullQuestionText(questions[index]);
    const lang = detectLang(questions[index].question);

    const useFallback = () => {
      fallbackSpeak(fullText, lang, () => {
        setIsSpeaking(false);
        setHasRead(true);
        preloadQuestion(index + 1, questions);
      });
    };

    try {
      let url = audioCacheRef.current[index];
      if (url === 'FALLBACK') throw new Error("Triggered Fallback Flag");
      
      if (!url) {
        url = await fetchTTS(fullText, true);
        audioCacheRef.current[index] = url;
      }
      
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.onended = () => {
          setIsSpeaking(false);
          setHasRead(true);
          preloadQuestion(index + 1, questions);
        };
        audioRef.current.onerror = useFallback;
        audioRef.current.play().catch(useFallback);
      } else {
        useFallback();
      }
    } catch (err) {
      console.warn("Using offline fallback voice due to API Error.");
      useFallback();
    }
  };

  const playMessageAudio = async (text) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    const lang = detectLang(text);
    
    const useFallback = () => {
      fallbackSpeak(text, lang, () => setIsSpeaking(false));
    };

    try {
      const url = await fetchTTS(text, false);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.onended = () => setIsSpeaking(false);
        audioRef.current.onerror = useFallback;
        audioRef.current.play().catch(useFallback);
      } else {
        useFallback();
      }
    } catch (err) {
      useFallback();
    }
  };

  const loadQuestions = async () => {
    try {
      const ctx = getAudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
    } catch(e) {}

    if (!csvUrl) {
      setError("Vui lòng nhập link CSV từ Google Drive.");
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
      if (!response.ok) throw new Error("Không thể tải file. Hãy đảm bảo file công khai.");
      const text = await response.text();
      let data = parseCSV(text);
      if (data.length === 0) throw new Error("File CSV trống.");
      
      for (let i = data.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [data[i], data[j]] = [data[j], data[i]];
      }

      data = data.map(q => {
        const origAns = (q.answer || '').trim().toLowerCase();
        if (!['a', 'b', 'c'].includes(origAns)) return q; 

        const correctText = q[origAns]; 
        let options = [q.a, q.b, q.c];

        for (let i = options.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [options[i], options[j]] = [options[j], options[i]];
        }

        const newCorrectIdx = options.indexOf(correctText);
        const newAnswer = ['A', 'B', 'C'][newCorrectIdx];

        return {
          ...q,
          a: options[0],
          b: options[1],
          c: options[2],
          answer: newAnswer 
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
      } else if (timeLeft === 0) {
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
      const nameToRead = playerName.trim() || 'bạn';
      let finalMessage = `Chúc mừng ${nameToRead}, bạn đã đạt được ${score} điểm.`;
      if (gameState === 'gameover') {
        finalMessage += ` ${nameToRead} cố gắng hơn lần sau nhé.`;
      }
      playMessageAudio(finalMessage);
    }
  }, [gameState, score, playerName]);

  const handleAnswer = async (choice) => {
    if (isRevealing) return;
    
    if (audioRef.current) {
      audioRef.current.pause();
      setIsSpeaking(false);
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    clearTimeout(timerRef.current);
    setSelectedChoice(choice);
    setIsRevealing(true);
    
    const correct = questions[currentIdx].answer.trim().toUpperCase();
    let isCorrect = false;
    if (choice !== null) {
      isCorrect = choice === correct;
    }

    if (isCorrect) {
      SoundEngine.playApplause();
    } else {
      SoundEngine.playWrong();
    }

    setIsSpeaking(true);
    let revealUrl = audioCacheRef.current[`reveal_${currentIdx}`];
    const correctText = questions[currentIdx][correct.toLowerCase()];
    const lang = detectLang(questions[currentIdx].question);
    const revealText = lang === 'en'
      ? `The correct answer is ${correct}, ${correctText}`
      : `Đáp án đúng là ${correct}, ${correctText}`;

    const playRevealFallback = async () => {
      return new Promise(resolve => {
        fallbackSpeak(revealText, lang, resolve);
      });
    };

    try {
      if (revealUrl === 'FALLBACK') throw new Error("Fallback cached");
      if (!revealUrl) {
        revealUrl = await fetchTTS(revealText, false);
      }

      if (revealUrl && audioRef.current) {
        await new Promise(resolve => {
          audioRef.current.src = revealUrl;
          audioRef.current.onended = resolve;
          audioRef.current.onerror = resolve; // Tiếp tục tiến trình nếu play lỗi
          audioRef.current.play().catch(resolve);
        });
      } else {
        await playRevealFallback();
      }
    } catch (e) {
      await playRevealFallback();
    }

    setIsSpeaking(false);

    await new Promise(res => setTimeout(res, 500));

    setIsRevealing(false);
    setSelectedChoice(null);
    setHasRead(false);

    if (isCorrect) {
      setScore(prev => prev + 1);
      if (currentIdx + 1 < questions.length) {
        setCurrentIdx(prev => prev + 1);
        setTimeLeft(10);
      } else {
        setGameState('win');
      }
    } else {
      setGameState('gameover');
    }
  };

  const resetGame = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
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
    const correct = questions[currentIdx]?.answer.trim().toUpperCase();
    if (!isRevealing) {
      return "border-slate-100 bg-white md:hover:border-amber-400 md:hover:bg-amber-50 active:bg-amber-50";
    }
    
    if (label === correct) {
      return "border-green-500 bg-green-50 ring-2 ring-green-200";
    }
    if (selectedChoice === label && label !== correct) {
      return "border-red-500 bg-red-50 ring-2 ring-red-200";
    }
    return "opacity-50 border-slate-100 bg-white";
  };

  return (
    <div className="min-h-[100dvh] bg-amber-50 flex items-center justify-center p-2 sm:p-4 font-sans text-slate-800 selection:bg-amber-200">
      <audio ref={audioRef} hidden playsInline />
      
      <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl overflow-hidden border-4 border-amber-400">
        
        {/* Header Section */}
        <div className="bg-amber-400 p-6 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-white p-2 rounded-full shadow-inner">
              <Trophy className="text-amber-500 w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight uppercase">Rung Chuông Vàng</h1>
          </div>
          {gameState === 'playing' && (
            <div className="flex flex-col items-end">
              <div className="bg-white/30 px-4 py-0.5 rounded-full text-white text-xs font-bold backdrop-blur-sm mb-1">
                Câu: {currentIdx + 1}/{questions.length}
              </div>
              <div className="bg-white/30 px-4 py-0.5 rounded-full text-white text-xs font-bold backdrop-blur-sm">
                Điểm: {score}
              </div>
            </div>
          )}
        </div>

        <div className="p-8">
          
          {gameState === 'config' && (
            <div className="space-y-6 text-center animate-in fade-in zoom-in duration-300">
              <div className="w-24 h-24 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="text-amber-600 w-12 h-12" />
              </div>
              <h2 className="text-xl font-bold">Cấu hình ván chơi</h2>
              
              <div className="text-left space-y-2">
                <label className="text-sm font-semibold text-slate-500 ml-1">Tên người chơi</label>
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Ví dụ: Mỹ An"
                  className="w-full p-4 rounded-xl border-2 border-slate-200 focus:border-amber-400 outline-none transition-all"
                />
              </div>

              <div className="text-left space-y-2">
                <label className="text-sm font-semibold text-slate-500 ml-1">Link Google Drive CSV</label>
                <input 
                  type="text" 
                  value={csvUrl}
                  onChange={(e) => setCsvUrl(e.target.value)}
                  placeholder="Dán link file Google Sheet tại đây..."
                  className="w-full p-4 rounded-xl border-2 border-slate-200 focus:border-amber-400 outline-none transition-all"
                />
              </div>
              {error && (
                <div className="bg-red-50 text-red-500 p-4 rounded-xl flex items-center gap-3 text-sm border border-red-100">
                  <AlertCircle size={20} /> {error}
                </div>
              )}
              <button 
                type="button"
                onClick={loadQuestions}
                className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 active:scale-[0.98] text-white font-bold py-4 rounded-xl shadow-lg transition-all touch-manipulation select-none"
              >
                Bắt đầu ngay
              </button>
            </div>
          )}

          {gameState === 'loading' && (
            <div className="py-20 text-center space-y-4">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-amber-500 border-t-transparent"></div>
              <p className="text-slate-500 font-medium">Đang chuẩn bị câu hỏi...</p>
            </div>
          )}

          {gameState === 'playing' && (
            <div className="space-y-8">
              
              <div className="space-y-2">
                <div className="flex justify-between items-end px-1">
                   <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    {!hasRead ? "Đang đọc câu hỏi..." : (timeLeft <= 3 ? "Sắp hết giờ!" : "Đang tính giờ")}
                   </span>
                   <span className={`text-xl font-black ${timeLeft <= 3 ? 'text-red-500 animate-pulse' : 'text-amber-500'}`}>
                    {timeLeft}s
                   </span>
                </div>
                <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                  <div 
                    className={`h-full transition-all duration-1000 ease-linear ${timeLeft <= 3 ? 'bg-red-500' : 'bg-amber-500'}`}
                    style={{ width: `${(timeLeft / 10) * 100}%` }}
                  />
                </div>
              </div>

              <div className="space-y-4 bg-slate-50 p-6 rounded-2xl border border-slate-100 relative">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-xl sm:text-2xl font-bold leading-tight">
                    {questions[currentIdx]?.question}
                  </h3>
                  <button 
                    type="button"
                    onClick={() => playQuestionAudio(currentIdx)}
                    disabled={isSpeaking || isRevealing}
                    className={`p-3 rounded-full transition-colors flex-shrink-0 touch-manipulation active:scale-90 ${isSpeaking ? 'bg-amber-100 text-amber-400' : 'bg-amber-500 text-white hover:bg-amber-600 shadow-md'}`}
                  >
                    <Volume2 size={24} className={isSpeaking ? 'animate-bounce' : ''} />
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:gap-4">
                {['A', 'B', 'C'].map((label) => {
                  const correct = questions[currentIdx]?.answer.trim().toUpperCase();
                  const isCorrectLabel = label === correct;
                  const isUserLabel = label === selectedChoice;

                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={isRevealing || !hasRead}
                      onClick={() => handleAnswer(label)}
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                      className={`group relative w-full p-4 sm:p-5 text-left border-2 rounded-2xl transition-all flex items-center gap-3 sm:gap-4 shadow-sm touch-manipulation select-none active:scale-[0.98] ${getChoiceStyle(label)}`}
                    >
                      <span className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center font-bold transition-colors ${
                        isRevealing && isCorrectLabel ? 'bg-green-500 text-white' : 
                        isRevealing && isUserLabel && !isCorrectLabel ? 'bg-red-500 text-white' : 
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {label}
                      </span>
                      <span className="text-lg font-medium">
                        {questions[currentIdx]?.[label.toLowerCase()]}
                      </span>
                      
                      {isRevealing && (
                        <div className="ml-auto">
                          {isCorrectLabel && <CheckCircle2 className="text-green-500" size={24} />}
                          {isUserLabel && !isCorrectLabel && <XCircle className="text-red-500" size={24} />}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {(gameState === 'gameover' || gameState === 'win') && (
            <div className="py-10 text-center space-y-6 animate-in zoom-in duration-300">
              <div className={`w-32 h-32 mx-auto rounded-full flex items-center justify-center text-6xl shadow-xl ${gameState === 'win' ? 'bg-green-100' : 'bg-red-100'}`}>
                {gameState === 'win' ? '🎊' : '🔔'}
              </div>
              <div>
                <h2 className="text-3xl font-black mb-2 uppercase">
                  {gameState === 'win' ? 'Chiến thắng!' : 'Bạn đã dừng lại!'}
                </h2>
                <p className="text-slate-500 text-lg">
                  {gameState === 'win' 
                    ? 'Bạn là người cuối cùng Rung Chuông Vàng!' 
                    : 'Rất tiếc, bạn đã trả lời chưa chính xác hoặc quá thời gian.'}
                </p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-6 inline-block min-w-[200px] border border-slate-100 shadow-sm">
                <div className="text-sm text-slate-400 uppercase font-bold tracking-widest mb-1">Tổng điểm</div>
                <div className="text-5xl font-black text-amber-500">{score}</div>
              </div>
              <div className="pt-4">
                <button 
                  type="button"
                  onClick={resetGame}
                  className="bg-amber-500 hover:bg-amber-600 active:bg-amber-700 active:scale-[0.98] text-white font-bold px-10 py-4 rounded-2xl shadow-lg transition-all flex items-center gap-2 mx-auto touch-manipulation select-none"
                >
                  <RotateCcw size={20} /> Chơi ván mới
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;