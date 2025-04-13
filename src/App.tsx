import React, { useState, useEffect } from 'react';
import { Search, Bus, Info, ArrowRight, Map as MapIcon, Download } from 'lucide-react';
import { MapContainer, TileLayer, GeoJSON, useMap, LayersControl, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { toGPX } from '@tmcw/togpx';
import L from 'leaflet';

// Ícones personalizados para os marcadores
const startIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png', // Ícone para o ponto inicial
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const endIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/149/149060.png', // Ícone para o ponto final
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

interface RouteDetails {
  short_name: string;
  long_name: string;
  municipalities: string[];
  localities: string[];
  patterns: string[];
  routes: string[];
}

interface Pattern {
  id: string;
  headsign: string;
  long_name: string;
  shape_id: string;
  route_id: string;
  route_long_name: string;
}

interface Shape {
  geojson: any;
}

// Component to handle map bounds updates
function MapUpdater({ geojson }: { geojson: any }) {
  const map = useMap();

  useEffect(() => {
    if (geojson) {
      const layer = L.geoJSON(geojson);
      const bounds = layer.getBounds();
      map.fitBounds(bounds);
    }
  }, [geojson, map]);

  return null;
}

function geojsonToGpx(geojson: any, origin: string, destination: string): string {
  if (!geojson || geojson.type !== "FeatureCollection") {
    throw new Error("GeoJSON inválido. Certifique-se de que é um FeatureCollection.");
  }

  const gpxHeader = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CustomConverter" xmlns="http://www.topografix.com/GPX/1/1">
`;

  const gpxFooter = `</gpx>`;

  // Adiciona waypoints para o início e o fim da rota
  const waypoints = (() => {
    const firstCoord = geojson.features[0]?.geometry.coordinates[0];
    const lastCoord =
      geojson.features[0]?.geometry.coordinates[
        geojson.features[0]?.geometry.coordinates.length - 1
      ];

    if (!firstCoord || !lastCoord) {
      throw new Error("Coordenadas de início ou fim não encontradas.");
    }

    return `
<wpt lon="${firstCoord[0]}" lat="${firstCoord[1]}">
  <name>${origin}</name>
</wpt>
<wpt lon="${lastCoord[0]}" lat="${lastCoord[1]}">
  <name>${destination}</name>
</wpt>
`;
  })();

  // Adiciona os segmentos da rota
  const gpxBody = geojson.features
    .map((feature: any) => {
      if (feature.geometry.type === "LineString") {
        const coordinates = feature.geometry.coordinates
          .map(
            (coord: number[]) =>
              `<trkpt lon="${coord[0]}" lat="${coord[1]}"></trkpt>`
          )
          .join("\n");
        return `<trk><name>${feature.properties?.name || "Rota"}</name><trkseg>${coordinates}</trkseg></trk>`;
      }
      return "";
    })
    .join("\n");

  return gpxHeader + waypoints + gpxBody + gpxFooter;
}

function App() {
  const [routeNumber, setRouteNumber] = useState('');
  const [routeDetails, setRouteDetails] = useState<RouteDetails | null>(null);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);
  const [shapeData, setShapeData] = useState<Shape | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const searchRoute = async () => {
    if (!routeNumber.trim()) {
      setError('Por favor, insira o número da rota.');
      return;
    }

    setLoading(true);
    setError('');
    setRouteDetails(null);
    setSelectedPattern(null);
    setShapeData(null);
    setPatterns([]);

    try {
      const response = await fetch(`https://api.carrismetropolitana.pt/lines/${routeNumber}`);
      if (!response.ok) {
        throw new Error(`Rota não encontrada`);
      }
      const data = await response.json();
      setRouteDetails(data);

      // Fetch all patterns details
      const patternsData = await Promise.all(
        data.patterns.map(async (patternId: string) => {
          const patternResponse = await fetch(`https://api.carrismetropolitana.pt/patterns/${patternId}`);
          if (!patternResponse.ok) throw new Error(`Erro ao carregar o padrão ${patternId}`);
          const patternData = await patternResponse.json();
          
          // Fetch route details to get the long name
          const routeResponse = await fetch(`https://api.carrismetropolitana.pt/routes/${patternData.route_id}`);
          if (!routeResponse.ok) throw new Error(`Erro ao carregar a rota ${patternData.route_id}`);
          const routeData = await routeResponse.json();
          
          return {
            ...patternData,
            route_long_name: routeData.long_name,
            long_name: routeData.long_name
          };
        })
      );
      setPatterns(patternsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao buscar rota');
    } finally {
      setLoading(false);
    }
  };

  const fetchPattern = async (pattern: Pattern) => {
    try {
      setSelectedPattern(pattern);
      const shapeResponse = await fetch(`https://api.carrismetropolitana.pt/shapes/${pattern.shape_id}`);
      if (!shapeResponse.ok) throw new Error('Erro ao carregar o shape');
      const shapeData = await shapeResponse.json();
      setShapeData(shapeData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados do padrão');
    }
  };

  const getRouteEndpoints = (headsign: string) => {
    const parts = headsign.split(' - ');
    return {
      origin: parts[0],
      destination: parts[parts.length - 1]
    };
  };

  const downloadGPX = () => {
    if (!shapeData || !shapeData.geojson) {
      setError("Nenhum dado de rota disponível para exportar.");
      return;
    }

    if (!selectedPattern) {
      setError("Nenhum padrão de rota selecionado.");
      return;
    }

    try {
      // Ajustar a estrutura do GeoJSON para um FeatureCollection
      const geojson = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: shapeData.geojson.geometry,
            properties: {}, // Adicione propriedades se necessário
          },
        ],
      };

      console.log("GeoJSON para GPX:", geojson); // Log para depuração

      // Obter o início e o fim da rota
      const { origin, destination } = getRouteEndpoints(selectedPattern.headsign);

      // Converte GeoJSON para GPX com início e fim
      const gpxData = geojsonToGpx(geojson, origin, destination);
      console.log("GPX gerado:", gpxData); // Log para depuração

      // Formatar o nome do arquivo
      const routeName = selectedPattern.long_name
        .replace(/[^a-zA-Z0-9\s]/g, "") // Remove caracteres especiais
        .replace(/\s+/g, "_") // Substitui espaços por underscores
        .trim(); // Remove espaços extras no início e no fim
      const fileName = `${routeDetails?.short_name || "Rota"}_${routeName}.gpx`;

      // Cria um link para download
      const blob = new Blob([gpxData], { type: "application/gpx+xml" });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();

      // Libera o URL após o download
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Erro ao gerar GPX:", err);
      setError("Erro ao gerar o arquivo GPX.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Bus className="w-10 h-10 text-blue-600" />
            <h1 className="text-4xl font-bold text-gray-900">Carris Metropolitana</h1>
          </div>
          <p className="text-gray-600 text-lg">Sistema de Consulta de Rotas</p>
        </div>

        {/* Search Section */}
        <div className="max-w-xl mx-auto mb-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex gap-2">
              <div className="flex-1">
                <div className="relative">
                  <input
                    type="text"
                    value={routeNumber}
                    onChange={(e) => setRouteNumber(e.target.value)}
                    placeholder="Digite o número da rota"
                    className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                  <Search className="absolute right-3 top-2.5 text-gray-400 w-5 h-5" />
                </div>
              </div>
              <button
                onClick={searchRoute}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-300"
              >
                {loading ? 'Buscando...' : 'Buscar'}
              </button>
            </div>
            {error && (
              <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg">
                <p className="flex items-center gap-2">
                  <Info className="w-5 h-5" />
                  {error}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Results Section */}
        {routeDetails && (
          <div className="bg-white rounded-lg shadow-md p-6 max-w-4xl mx-auto">
            <div className="border-b pb-4 mb-4">
              <h2 className="text-2xl font-semibold text-gray-900">
                Rota {routeDetails.short_name}
              </h2>
              <p className="text-gray-600">{routeDetails.long_name}</p>
            </div>

            {/* Patterns Section */}
            <div className="mt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-3 flex items-center gap-2">
                <MapIcon className="w-5 h-5 text-blue-600" />
                Selecionar percurso/destino
              </h3>
              <div className="grid gap-3">
                {patterns.map((pattern) => {
                  const { origin, destination } = getRouteEndpoints(pattern.headsign);
                  return (
                    <button
                      key={pattern.id}
                      onClick={() => fetchPattern(pattern)}
                      className={`text-left px-4 py-3 rounded-lg transition-colors ${
                        selectedPattern?.id === pattern.id
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          {/* Nome da rota sem estilização */}
                          <p className="font-bold text-base">
                            {origin} - {destination}
                          </p>
                          <p className="text-sm text-gray-600 mt-1">
                            {pattern.route_long_name}
                          </p>
                        </div>
                        <ArrowRight
                          className={`w-5 h-5 flex-shrink-0 ${
                            selectedPattern?.id === pattern.id ? 'text-blue-600' : 'text-gray-400'
                          }`}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Map Section */}
            <div className="mt-6">
              <div className="relative">
                <div className="h-[400px] w-full rounded-lg border border-gray-200 overflow-hidden">
                  <MapContainer
                    center={[38.736946, -9.142685]}
                    zoom={12}
                    style={{ height: '100%', width: '100%' }}
                  >
                    {/* Camadas e marcadores */}
                    <LayersControl position="topright">
                      <LayersControl.BaseLayer checked name="Mapa">
                        <TileLayer
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        />
                      </LayersControl.BaseLayer>
                      <LayersControl.BaseLayer name="Satélite">
                        <TileLayer
                          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                          attribution='&copy; <a href="https://www.esri.com">Esri</a>'
                        />
                      </LayersControl.BaseLayer>
                    </LayersControl>

                    {shapeData && <GeoJSON key={selectedPattern?.id} data={shapeData.geojson} />}
                    {shapeData && <MapUpdater geojson={shapeData.geojson} />}

                    {shapeData && shapeData.geojson && (
                      <>
                        <Marker
                          position={[
                            shapeData.geojson.geometry.coordinates[0][1],
                            shapeData.geojson.geometry.coordinates[0][0],
                          ]}
                          icon={startIcon}
                        >
                          <Popup>Início: {getRouteEndpoints(selectedPattern?.headsign || '').origin}</Popup>
                        </Marker>

                        <Marker
                          position={[
                            shapeData.geojson.geometry.coordinates[
                              shapeData.geojson.geometry.coordinates.length - 1
                            ][1],
                            shapeData.geojson.geometry.coordinates[
                              shapeData.geojson.geometry.coordinates.length - 1
                            ][0],
                          ]}
                          icon={endIcon}
                        >
                          <Popup>Fim: {getRouteEndpoints(selectedPattern?.headsign || '').destination}</Popup>
                        </Marker>
                      </>
                    )}
                  </MapContainer>
                </div>

                {/* Botão para baixar GPX */}
                {selectedPattern && (
                  <button
                    onClick={downloadGPX}
                    className="absolute bottom-4 left-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-md flex items-center gap-2 hover:bg-blue-700 transition-colors z-[1000]"
                  >
                    <Download className="w-5 h-5" />
                    <span>Baixar GPX</span>
                  </button>
                )}
              </div>

              {/* Legenda */}
              <div className="mt-4 flex items-center gap-4">
                {/* Ponto de origem */}
                <div className="flex items-center gap-2">
                  <img
                    src="https://cdn-icons-png.flaticon.com/512/684/684908.png"
                    alt="Ponto de origem"
                    className="w-6 h-6"
                  />
                  <span className="text-gray-700 font-medium">Origem</span>
                </div>

                {/* Ponto de destino */}
                <div className="flex items-center gap-2">
                  <img
                    src="https://cdn-icons-png.flaticon.com/512/149/149060.png"
                    alt="Ponto de destino"
                    className="w-6 h-6"
                  />
                  <span className="text-gray-700 font-medium">Destino</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
