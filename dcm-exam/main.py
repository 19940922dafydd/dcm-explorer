import os
import sys
import time
import json
import threading
import webview
import pydicom

class Api:
    def __init__(self):
        self._window = None
        self.is_cancelled = False

    def set_window(self, window):
        self._window = window

    # --- UI Invoked Actions --- #
    def select_folder(self):
        # Trigger native folder selection
        if not self._window: return None
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if result and len(result) > 0:
            return result[0]
        return None
        
    def stop_scan(self):
        self.is_cancelled = True

    def start_scan(self, data):
        # Run scan in thread to avoid blocking pywebview main thread
        threading.Thread(target=self._scan_thread, args=(data,), daemon=True).start()

    def analyze_dicom(self, paths):
        # Run parsing in thread
        threading.Thread(target=self._analyze_thread, args=(paths,), daemon=True).start()
        
    def export_files(self, data):
        # Actually export_files would need a targetFolder. We can define this if needed.
        pass

    # --- Worker Threads --- #
    def _scan_thread(self, data):
        self.is_cancelled = False
        root_path = data.get('rootPath')
        start_ts = data.get('startTs', 0)
        end_ts = data.get('endTs', float('inf'))

        batch = []
        BATCH_SIZE = 100
        total_scanned = [0]

        def fast_scan(path_str):
            if self.is_cancelled: return
            try:
                for entry in os.scandir(path_str):
                    if self.is_cancelled: return
                    
                    if entry.is_dir(follow_symlinks=False):
                        fast_scan(entry.path)
                    elif entry.is_file(follow_symlinks=False):
                        total_scanned[0] += 1
                        if total_scanned[0] % 1000 == 0:
                            self._window.evaluate_js(f"if(window.onScanProgressTotal) window.onScanProgressTotal({total_scanned[0]})")
                            
                        if entry.name.lower().endswith('.dcm'):
                            try:
                                stat = entry.stat()
                                mtime_ms = int(stat.st_mtime * 1000)
                                
                                if start_ts <= mtime_ms <= end_ts:
                                    batch.append({
                                        'name': entry.name,
                                        'path': entry.path,
                                        'lastModified': mtime_ms,
                                        'size': stat.st_size,
                                        'dicom': None
                                    })
                                    
                                    if len(batch) >= BATCH_SIZE:
                                        self._send_scan_batch(batch)
                                        batch.clear()
                                        time.sleep(0.001)
                            except Exception:
                                pass
            except Exception:
                pass

        fast_scan(root_path)

        if len(batch) > 0:
            self._send_scan_batch(batch)
            
        self._window.evaluate_js(f"if(window.onScanFinished) window.onScanFinished({total_scanned[0]})")

    def _send_scan_batch(self, batch):
        batch_json = json.dumps(batch).replace('\\', '\\\\').replace('"', '\\"')
        script = f'if(window.onScanResultsBatch) window.onScanResultsBatch(JSON.parse("{batch_json}"));'
        self._window.evaluate_js(script)


    def _analyze_thread(self, paths):
        self.is_cancelled = False
        batch = []
        BATCH_SIZE = 10
        analyzed_count = 0

        for path in paths:
            if self.is_cancelled: return
            dicom_data = {}
            try:
                # Read header only (fast)
                ds = pydicom.dcmread(path, stop_before_pixels=True)
                
                def get_str(name):
                    try:
                        val = getattr(ds, name, None)
                        if val is None: return ''
                        if hasattr(val, 'decode'): return val.decode('utf-8', 'ignore')
                        return str(val)
                    except:
                        return ''

                dicom_data = {
                    'patientName': get_str('PatientName').replace('^', ' ').strip(),
                    'patientId': get_str('PatientID').strip(),
                    'patientAge': get_str('PatientAge').strip(),
                    'studyDate': get_str('StudyDate').strip(),
                    'modality': get_str('Modality').strip(),
                    'bodyPart': get_str('BodyPartExamined').strip()
                }
            except Exception as e:
                pass

            batch.append({
                'path': path,
                'dicom': dicom_data
            })
            analyzed_count += 1
            
            if len(batch) >= BATCH_SIZE:
                self._send_analyze_batch(batch)
                batch = []
                time.sleep(0.01)
                
        if len(batch) > 0:
            self._send_analyze_batch(batch)
            
        self._window.evaluate_js(f"if(window.onAnalyzeFinished) window.onAnalyzeFinished({analyzed_count})")

    def _send_analyze_batch(self, batch):
        batch_json = json.dumps(batch).replace('\\', '\\\\').replace('"', '\\"')
        script = f'if(window.onAnalyzeResultsBatch) window.onAnalyzeResultsBatch(JSON.parse("{batch_json}"));'
        self._window.evaluate_js(script)


def get_base_path():
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

if __name__ == '__main__':
    api = Api()
    
    # Resolve the index.html path robustly
    index_path = os.path.join(get_base_path(), 'web', 'index.html')
    
    # Create the webview window
    win = webview.create_window(
        'DCM Resource Manager (Python)',
        index_path,
        js_api=api,
        width=1200,
        height=850,
        background_color='#0f172a'
    )
    api.set_window(win)
    
    webview.start(debug=True)
