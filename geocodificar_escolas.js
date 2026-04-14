const { createClient } = require('@supabase/supabase-js')

const sb = createClient(
  'https://ppbdxraeygravuwtandr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwYmR4cmFleWdyYXZ1d3RhbmRyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDczNjI4MCwiZXhwIjoyMDkwMzEyMjgwfQ.-WBt06BImGKuKOa1lSWr2e_EHIToNscuXbo0IiRbn-8'
)

// Coordenadas dos bairros de Itabuna como fallback
const BAIRROS = {
  'ferradas':         [-14.8420, -39.2890],
  'nova ferradas':    [-14.8380, -39.2850],
  'jorge amado':      [-14.8150, -39.2780],
  'nova itabuna':     [-14.8100, -39.2900],
  'lomanto junior':   [-14.8050, -39.2950],
  'lomanto júnior':   [-14.8050, -39.2950],
  'manoel leao':      [-14.8200, -39.3100],
  'urbis iv':         [-14.8000, -39.3000],
  'jardim primavera': [-14.7950, -39.3050],
  'vila analia':      [-14.7980, -39.2950],
  'vila anália':      [-14.7980, -39.2950],
  'santa clara':      [-14.8100, -39.2800],
  'banco raso':       [-14.7850, -39.2900],
  'mangabinha':       [-14.7780, -39.2950],
  'nova mangabinha':  [-14.7750, -39.2980],
  'bananeira':        [-14.7700, -39.3000],
  'maria pinheiro':   [-14.7900, -39.3150],
  'sao caetano':      [-14.7850, -39.3200],
  'são caetano':      [-14.7850, -39.3200],
  'pedro jeronimo':   [-14.7950, -39.3250],
  'pedro jerônimo':   [-14.7950, -39.3250],
  'fonseca':          [-14.7800, -39.3300],
  'novo fonseca':     [-14.7820, -39.3280],
  'sao pedro':        [-14.7750, -39.2850],
  'são pedro':        [-14.7750, -39.2850],
  'conceicao':        [-14.7700, -39.2900],
  'conceição':        [-14.7700, -39.2900],
  'zizo':             [-14.7680, -39.2950],
  'sao judas tadeu':  [-14.7650, -39.3000],
  'são judas tadeu':  [-14.7650, -39.3000],
  'novo horizonte':   [-14.7600, -39.3050],
  'santo antonio':    [-14.7550, -39.3100],
  'santo antônio':    [-14.7550, -39.3100],
  'sao lourenco':     [-14.7500, -39.3150],
  'são lourenço':     [-14.7500, -39.3150],
  'fatima':           [-14.7800, -39.2750],
  'fátima':           [-14.7800, -39.2750],
  'joao soares':      [-14.7850, -39.2700],
  'joão soares':      [-14.7850, -39.2700],
  'california':       [-14.7700, -39.2650],
  'califórnia':       [-14.7700, -39.2650],
  'nova california':  [-14.7650, -39.2600],
  'nova califórnia':  [-14.7650, -39.2600],
  'parque boa vista': [-14.7730, -39.2700],
  'monte cristo':     [-14.7600, -39.2700],
  'santa ines':       [-14.7550, -39.2750],
  'santa inês':       [-14.7550, -39.2750],
  'sao roque':        [-14.7500, -39.2800],
  'são roque':        [-14.7500, -39.2800],
  'antique':          [-14.7480, -39.2850],
  'centro':           [-14.7900, -39.2800],
  'zona rural':       [-14.8500, -39.3500],
  'ribeirão seco':    [-14.9000, -39.3800],
  'ribeirao seco':    [-14.9000, -39.3800],
  'ferradas rural':   [-14.8600, -39.3200],
  'mutuns':           [-14.8800, -39.3600],
  'itamaraca':        [-14.8700, -39.4000],
  'itamaracá':        [-14.8700, -39.4000],
  'sarinha':          [-14.8600, -39.3400],
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function geocodificar(query) {
  const q = encodeURIComponent(query)
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br`
  const res = await fetch(url, { headers: { 'User-Agent': 'CentralOSEletrica/1.0' } })
  const data = await res.json()
  if (data && data.length > 0) {
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  }
  return null
}

async function main() {
  console.log('Buscando escolas sem coordenadas...')
  const { data: escolas, error } = await sb.from('locations').select('*').is('latitude', null)
  
  if (error) { console.error('Erro:', error.message); return }
  if (!escolas || escolas.length === 0) { console.log('Todas as escolas já têm coordenadas!'); return }
  
  console.log(`${escolas.length} escolas para geocodificar\n`)

  let ok = 0, fallback = 0, falhou = 0

  for (let i = 0; i < escolas.length; i++) {
    const esc = escolas[i]
    process.stdout.write(`[${i+1}/${escolas.length}] ${esc.name.slice(0,40).padEnd(40)} `)

    let coord = null

    // Estratégia 1: nome + itabuna
    if (!coord) {
      coord = await geocodificar(`${esc.name} Itabuna Bahia`)
      await sleep(1100)
    }

    // Estratégia 2: endereço + bairro + itabuna
    if (!coord && esc.address) {
      coord = await geocodificar(`${esc.address} ${esc.neighborhood||''} Itabuna Bahia`)
      await sleep(1100)
    }

    // Estratégia 3: só o bairro como fallback
    if (!coord && esc.neighborhood) {
      const bKey = esc.neighborhood.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      const bairroKey = esc.neighborhood.toLowerCase()
      const coords = BAIRROS[bairroKey] || BAIRROS[bKey]
      if (coords) {
        // Adicionar pequena variação para não sobrepor marcadores
        coord = {
          lat: coords[0] + (Math.random() - 0.5) * 0.003,
          lng: coords[1] + (Math.random() - 0.5) * 0.003
        }
        fallback++
      }
    }

    if (coord) {
      await sb.from('locations').update({ latitude: coord.lat, longitude: coord.lng }).eq('id', esc.id)
      if (fallback > ok + falhou) {
        console.log(`⚡ FALLBACK BAIRRO`)
      } else {
        console.log(`✅ OK (${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)})`)
        ok++
      }
    } else {
      console.log(`❌ Não encontrada`)
      falhou++
    }
  }

  console.log(`\n✅ Geocodificadas: ${ok} | ⚡ Fallback bairro: ${fallback} | ❌ Falhou: ${falhou}`)
  console.log('Atualize o mapa no sistema para ver todas as escolas!')
}

main().catch(console.error)
