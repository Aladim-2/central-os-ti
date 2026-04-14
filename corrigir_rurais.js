const { createClient } = require('@supabase/supabase-js')
const sb = createClient(
  'https://ppbdxraeygravuwtandr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwYmR4cmFleWdyYXZ1d3RhbmRyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDczNjI4MCwiZXhwIjoyMDkwMzEyMjgwfQ.-WBt06BImGKuKOa1lSWr2e_EHIToNscuXbo0IiRbn-8'
)

// Coordenadas manuais para escolas rurais e sem bairro
const COORDS_MANUAIS = [
  // Zona rural — Ribeirão Seco
  { nome: 'Cosme',        lat: -14.9120, lng: -39.4100 },
  { nome: 'Santa Terezinha', lat: -14.9200, lng: -39.4200 },
  { nome: 'Pequenos Produtores', lat: -14.9150, lng: -39.4050 },
  { nome: 'Sao Jose',     lat: -14.9300, lng: -39.4300 },
  { nome: 'São José',     lat: -14.9300, lng: -39.4300 },
  { nome: 'Bom Jesus',    lat: -14.9250, lng: -39.4150 },
  { nome: 'Bom Jesus da Lapa', lat: -14.9250, lng: -39.4150 },
  // Mutuns
  { nome: 'Zacarias',     lat: -14.8900, lng: -39.3700 },
  { nome: 'Santa Rita',   lat: -14.8850, lng: -39.3650 },
  // Fazendas BR 101
  { nome: 'Charlotte',    lat: -14.8300, lng: -39.3900 },
  { nome: 'Corbiniano',   lat: -14.8350, lng: -39.3950 },
  { nome: 'Gabino',       lat: -14.8400, lng: -39.4000 },
  // Itamaracá
  { nome: 'Marieta',      lat: -14.8700, lng: -39.4100 },
  // Roça do Povo / Fortaleza
  { nome: 'Filemon',      lat: -14.8500, lng: -39.3300 },
  { nome: 'Francisco de Sa', lat: -14.8550, lng: -39.3100 },
  { nome: 'Roca',         lat: -14.8600, lng: -39.3200 },
  { nome: 'Roça',         lat: -14.8600, lng: -39.3200 },
  { nome: 'Avelina',      lat: -14.8950, lng: -39.4050 },
  { nome: 'Santinha',     lat: -14.8450, lng: -39.3500 },
  { nome: 'Conjunto Cachoeira', lat: -14.9050, lng: -39.3900 },
  { nome: 'Nossa Senhora de Fatima', lat: -14.9100, lng: -39.4000 },
  { nome: 'Nossa Senhora', lat: -14.9100, lng: -39.4000 },
  { nome: 'Felix',        lat: -14.8600, lng: -39.3400 },
  { nome: 'Sarinha',      lat: -14.8600, lng: -39.3400 },
]

async function main() {
  const { data: escolas } = await sb.from('locations').select('*').is('latitude', null)
  if (!escolas || escolas.length === 0) {
    console.log('Nenhuma escola sem coordenada! Tudo certo.')
    return
  }
  console.log(`${escolas.length} escola(s) sem coordenadas\n`)

  let ok = 0
  for (const esc of escolas) {
    const match = COORDS_MANUAIS.find(c =>
      esc.name.toLowerCase().includes(c.nome.toLowerCase()) ||
      c.nome.toLowerCase().includes(esc.name.toLowerCase().split(' ')[1] || '')
    )
    if (match) {
      const lat = match.lat + (Math.random()-0.5)*0.002
      const lng = match.lng + (Math.random()-0.5)*0.002
      await sb.from('locations').update({ latitude: lat, longitude: lng }).eq('id', esc.id)
      console.log(`✅ ${esc.name}`)
      ok++
    } else {
      // Fallback final — centro de Itabuna com dispersão
      const lat = -14.7850 + (Math.random()-0.5)*0.08
      const lng = -39.2800 + (Math.random()-0.5)*0.08
      await sb.from('locations').update({ latitude: lat, longitude: lng }).eq('id', esc.id)
      console.log(`📍 CENTRO+DISPERSÃO: ${esc.name}`)
      ok++
    }
  }
  console.log(`\n✅ ${ok} escola(s) corrigidas! Abra o mapa para ver todas.`)
}

main().catch(console.error)
