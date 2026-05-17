import React, { useState, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import Plot from 'react-plotly.js';
import { UploadCloud, AlertCircle, BarChart2, Settings, Send, Loader2 } from 'lucide-react';

declare global {
  interface Window {
    dfd: any;
  }
}

interface PlotConfig {
  type: string;
  x_column: string;
  y_column: string;
  group_by_column: string | null;
  layout_overrides: any;
}

export default function App() {
  const [dataFrame, setDataFrame] = useState<any | null>(null);
  const [tableData, setTableData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<string | null>(null);
  
  const [plotData, setPlotData] = useState<{ traces: any[], layoutConfig: any, xCol: string, yCol: string } | null>(null);
  const [metadata, setMetadata] = useState<{ rows: number, cols: number } | null>(null);
  const [schema, setSchema] = useState<{ name: string, type: string }[] | null>(null);

  const [chatInput, setChatInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const processCSV = (file: File) => {
    setFileName(file.name);
    setFileSize((file.size / 1024 / 1024).toFixed(2) + 'MB');
    
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data || results.data.length === 0) {
          setError("The uploaded CSV file is empty or could not be parsed.");
          return;
        }

        try {
          if (!window.dfd) {
             setError("DanfoJS is still loading or failed to load. Please refresh.");
             return;
          }

          // Instantiate Danfo.js DataFrame
          const df = new window.dfd.DataFrame(results.data as any);
          
          if (df.shape.length !== 2) {
            setError("Could not determine DataFrame shape.");
            return;
          }
          
          const rows = df.shape[0];
          const cols = df.shape[1];
          setMetadata({ rows, cols });
          
          // Data Table Preview (First 10 rows)
          const headDf = df.head(10);
          const headJson = window.dfd.toJSON(headDf) as any[];
          setTableData(headJson);
          setColumns(df.columns);

          // Automatic Visualization Heuristic
          let xCol = '';
          let yCol = '';
          
          const types = df.ctypes.values as string[];
          const dtypes = df.columns.map((col: string, i: number) => ({ name: col, type: types[i] }));
          setSchema(dtypes);
          
          // X-Axis: FIRST string or date
          const xCandidate = dtypes.find((d: any) => d.type === 'string' || d.type === 'datetime');
          // Y-Axis: FIRST numeric
          const yCandidate = dtypes.find((d: any) => d.type === 'float32' || d.type === 'int32' || d.type === 'float64' || d.type === 'int64');

          if (xCandidate && yCandidate) {
            xCol = xCandidate.name;
            yCol = yCandidate.name;
            
            const xValues = df[xCol].values;
            const yValues = df[yCol].values;
            
            setPlotData({
              traces: [{ x: xValues, y: yValues, type: 'bar', marker: { color: '#818cf8', opacity: 0.8 } }],
              layoutConfig: {},
              xCol, yCol 
            });
            setError(null);
          } else if (yCandidate) {
             // Fallback: Use index as X if no string column
             xCol = 'Index';
             yCol = yCandidate.name;
             setPlotData({
               traces: [{ x: df.index, y: df[yCol].values, type: 'bar', marker: { color: '#818cf8', opacity: 0.8 } }],
               layoutConfig: {},
               xCol, yCol 
             });
             setError(null);
          } else {
             setPlotData(null);
             setError("No numeric columns found for visualization.");
          }
          
          setDataFrame(df);

        } catch (err: any) {
          console.error(err);
          setError("Error processing data: " + (err.message || String(err)));
        }
      },
      error: (err) => {
        setError("Error parsing CSV: " + err.message);
      }
    });
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'text/csv' || file.name.endsWith('.csv'))) {
      processCSV(file);
    } else {
      setError("Please drop a valid CSV file.");
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processCSV(file);
    }
  };

  const handleGenerateChart = async () => {
    if (!chatInput.trim() || !dataFrame || !schema) return;

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/generate-chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: chatInput, schema }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to generate chart config.');
      }

      const config: PlotConfig = await response.json();
      
      // Update Chart State
      let dataTraces: any[] = [];
      const xCol = config.x_column;
      const yCol = config.y_column;
      
      if (!dataFrame.columns.includes(xCol) && xCol !== 'Index') {
         throw new Error(`Column ${xCol} not found in dataset.`);
      }
      if (!dataFrame.columns.includes(yCol)) {
         throw new Error(`Column ${yCol} not found in dataset.`);
      }

      const xValues = xCol === 'Index' ? dataFrame.index : dataFrame[xCol].values;
      const yValues = dataFrame[yCol].values;

      if (config.group_by_column && dataFrame.columns.includes(config.group_by_column)) {
        // Grouping logic over dataFrame
        const groupCol = config.group_by_column;
        const groups = Array.from(new Set(dataFrame[groupCol].values));
        
        groups.forEach(group => {
           // We have to filter rows manually or via df.query. 
           // For simplicity & robustness with danfo:
           const mask = dataFrame[groupCol].eq(group);
           const filteredDf = dataFrame.loc({ rows: mask });
           
           if (filteredDf && filteredDf.shape[0] > 0) {
             const grpX = xCol === 'Index' ? filteredDf.index : filteredDf[xCol].values;
             const grpY = filteredDf[yCol].values;
             dataTraces.push({
               x: grpX,
               y: grpY,
               type: config.type,
               name: String(group),
               opacity: 0.8
             });
           }
        });
      } else {
        // Simple 1 trace
        dataTraces.push({
           x: xValues,
           y: yValues,
           type: config.type,
           marker: { color: '#818cf8', opacity: 0.8 },
        });
      }

      setPlotData({
        traces: dataTraces,
        layoutConfig: config.layout_overrides || {},
        xCol, yCol
      });

    } catch (err: any) {
      console.error(err);
      setError("AI Generation failed: " + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="w-full h-full bg-slate-950 text-slate-200 flex flex-col font-sans overflow-hidden">
      {/* Header / Metadata Bar */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-xl tracking-tight">
            <div className="w-6 h-6 bg-indigo-500 rounded flex items-center justify-center text-slate-950 text-xs italic">V</div>
            VibeAnalyze
          </div>
          <div className="h-4 w-px bg-slate-700"></div>
          <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">Phase 2: Conversational Charts</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-500 uppercase">Dataset Status</span>
            <span className={`text-xs font-mono ${dataFrame ? 'text-emerald-400' : 'text-slate-500'}`}>
              {dataFrame ? 'LIVE_PROCESS_READY' : 'WAITING_FOR_DATA'}
            </span>
          </div>
          <div className="bg-slate-800/50 rounded-lg px-3 py-1.5 flex gap-4 border border-slate-700">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase">Rows</span>
              <span className="text-sm font-mono">{metadata ? metadata.rows.toLocaleString() : '-'}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase">Cols</span>
              <span className="text-sm font-mono">{metadata ? metadata.cols.toLocaleString() : '-'}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <div className={`px-2 py-1 bg-slate-800 rounded border ${plotData ? 'border-indigo-500/30' : 'border-slate-700'} flex items-center gap-2`}>
              <span className="text-[10px] text-slate-500 uppercase">X:</span>
              <span className={`text-xs font-mono ${plotData ? 'text-indigo-300' : 'text-slate-500'} italic truncate max-w-[100px]`}>
                {plotData ? plotData.xCol : 'none'}
              </span>
            </div>
            <div className={`px-2 py-1 bg-slate-800 rounded border ${plotData ? 'border-emerald-500/30' : 'border-slate-700'} flex items-center gap-2`}>
              <span className="text-[10px] text-slate-500 uppercase">Y:</span>
              <span className={`text-xs font-mono ${plotData ? 'text-emerald-300' : 'text-slate-500'} italic truncate max-w-[100px]`}>
                {plotData ? plotData.yCol : 'none'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col p-4 gap-4 min-h-0">
        
        {/* Drop Zone Area */}
        <section 
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => document.getElementById('csv-upload')?.click()}
          className="h-24 flex-shrink-0 bg-slate-900 border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl flex items-center justify-center gap-4 group cursor-pointer transition-colors px-6"
        >
          <input 
            id="csv-upload" 
            type="file" 
            accept=".csv" 
            className="hidden" 
            onChange={handleChange} 
          />
          <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center group-hover:bg-slate-700 transition-colors flex-shrink-0">
            <UploadCloud className="w-5 h-5 text-slate-400 group-hover:text-indigo-400 transition-colors" />
          </div>
          <div className="flex flex-col flex-grow">
            <span className="text-sm font-medium">{fileName ? fileName : 'Upload dataset'}</span>
            <span className="text-xs text-slate-500 italic">{fileName ? 'Click to replace or drag new files here.' : 'Drop your CSV here or click to browse'}</span>
          </div>
          {fileName && (
            <div className="ml-auto mr-8 flex gap-2 flex-shrink-0">
              <span className="px-2 py-1 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">CSV {fileSize}</span>
              <span className="px-2 py-1 rounded text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">DANFO_READY</span>
            </div>
          )}
        </section>

        {/* Error State */}
        {error && (
          <div className="bg-red-950/50 border border-red-900 text-red-400 p-3 rounded-xl flex items-center space-x-3 text-sm flex-shrink-0">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Charts Section with AI Chat */}
        <section className="flex-grow min-h-0 flex gap-4 overflow-hidden">
          {/* Chart Wrapper */}
          <div className="flex-grow bg-slate-900 rounded-xl border border-slate-800 flex flex-col overflow-hidden relative">
            <div className="p-3 border-b border-slate-800 flex justify-between items-center z-10 bg-slate-900/80">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {plotData ? `${plotData.yCol} vs ${plotData.xCol} (AI Chart)` : 'Analytics Overview'}
              </h3>
              <div className="flex gap-2">
                <button className="p-1 text-slate-500 hover:text-slate-200">
                  <BarChart2 className="w-4 h-4" />
                </button>
                <button className="p-1 text-slate-500 hover:text-slate-200">
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-grow flex flex-col relative w-full h-full">
              {plotData ? (
                <div className="absolute inset-0">
                  <Plot
                    data={plotData.traces}
                    layout={{
                      autosize: true,
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                      font: { color: '#94a3b8', family: 'Inter, sans-serif' },
                      xaxis: { 
                        title: { text: plotData.xCol },
                        gridcolor: '#334155',
                        zerolinecolor: '#475569',
                        tickfont: { size: 10 }
                      },
                      yaxis: { 
                        title: { text: plotData.yCol },
                        gridcolor: '#334155',
                        zerolinecolor: '#475569',
                        tickfont: { size: 10 }
                      },
                      margin: { t: 30, r: 20, b: 50, l: 60 },
                      hoverlabel: { bgcolor: '#1e293b', font: { color: '#cbd5e1' } },
                      ...plotData.layoutConfig
                    }}
                    useResizeHandler={true}
                    style={{ width: '100%', height: '100%' }}
                    config={{ displayModeBar: false, responsive: true }}
                  />
                </div>
              ) : (
                <div className="flex-grow flex items-center justify-center p-8">
                  <div className="text-slate-500 text-sm italic">
                    Upload a dataset with numeric columns to see visualization.
                  </div>
                </div>
              )}
               {/* Loading Overlay */}
              {isGenerating && (
                <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center z-20">
                  <div className="flex flex-col items-center gap-4 bg-slate-900 border border-slate-700 p-6 rounded-2xl shadow-2xl">
                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                    <span className="text-sm font-medium text-slate-300">Gemini is designing your chart...</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Chat Side Panel */}
          <div className="flex-shrink-0 w-80 bg-slate-900 rounded-xl border border-slate-800 flex flex-col overflow-hidden">
             <div className="p-3 border-b border-slate-800 bg-slate-900/80">
               <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Conversational AI</h3>
             </div>
             <div className="flex-grow p-4 flex flex-col justify-end gap-4 overflow-y-auto">
               <div className="bg-slate-800/50 rounded-lg p-3 text-sm text-slate-300 border border-slate-700">
                 Hi! I'm your AI Data Assistant. Upload a CSV, then ask me to change the chart type, grouping, or styling!
               </div>
               {/* Quick examples */}
               {dataFrame && (
                 <div className="flex flex-col gap-2">
                   <span className="text-xs text-slate-500 uppercase font-semibold tracking-wider">Try asking:</span>
                   <button onClick={() => setChatInput("Make it a scatter plot with a dark theme")} className="text-left text-xs bg-slate-800/80 hover:bg-slate-700 text-indigo-300 py-1.5 px-3 rounded border border-slate-700 transition">"Make it a scatter plot with a dark theme"</button>
                   <button onClick={() => setChatInput("Change to a horizontal bar chart")} className="text-left text-xs bg-slate-800/80 hover:bg-slate-700 text-indigo-300 py-1.5 px-3 rounded border border-slate-700 transition">"Change to a horizontal bar chart"</button>
                 </div>
               )}
             </div>
             <div className="p-3 bg-slate-950 mt-auto border-t border-slate-800">
               <div className="relative flex items-center">
                 <input
                   type="text"
                   disabled={!dataFrame || isGenerating}
                   value={chatInput}
                   onChange={(e) => setChatInput(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') handleGenerateChart(); }}
                   placeholder={dataFrame ? "Ask Gemini to build a chart..." : "Upload data first"}
                   className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2.5 pl-3 pr-10 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 transition-all"
                 />
                 <button 
                  disabled={!dataFrame || isGenerating || !chatInput.trim()}
                  onClick={handleGenerateChart}
                  className="absolute right-2 p-1.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-md disabled:opacity-50 disabled:bg-slate-700 disabled:text-slate-500 transition-colors"
                 >
                   <Send className="w-3.5 h-3.5" />
                 </button>
               </div>
             </div>
          </div>
        </section>

        {/* Table Preview Section */}
        <section className="h-[280px] flex-shrink-0 bg-slate-900 rounded-xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-800 bg-slate-900/80 flex items-center">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Head(10) Preview</h3>
          </div>
          <div className="overflow-auto flex-grow relative">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-950/50 sticky top-0 z-10">
                <tr>
                  {columns.map((col, i) => (
                    <th key={col + i} className="p-2 text-[11px] font-bold text-slate-500 border-b border-slate-800 uppercase tracking-tighter whitespace-nowrap bg-slate-950/90 hover:text-slate-300">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-xs font-mono">
                {tableData.length > 0 ? tableData.map((row, i) => (
                  <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    {columns.map((col, j) => (
                      <td key={col + j} className="p-2 text-slate-400 whitespace-nowrap">
                        {row[col] !== null && row[col] !== undefined ? String(row[col]) : ''}
                      </td>
                    ))}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={100} className="p-8 text-center text-slate-500 italic border-none">
                      No data loaded
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="p-2 bg-slate-950/50 border-t border-slate-800 flex justify-center">
            <span className="text-[10px] text-slate-500">
              Displaying first 10 rows of {metadata?.rows.toLocaleString() || '0'} available.
            </span>
          </div>
        </section>
      </main>

      {/* Footer Bar */}
      <footer className="h-8 flex-shrink-0 bg-slate-900 border-t border-slate-800 px-6 flex items-center justify-between text-[10px] font-mono text-slate-600">
        <div>Engine: Danfo.js Core v1.1.2 | PapaParse Runtime | Gemini AI</div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> FULL_STACK_READY</span>
          <span>Latency: &lt;10ms</span>
        </div>
      </footer>
    </div>
  );
}
