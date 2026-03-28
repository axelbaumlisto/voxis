-- Monochrome Theme
-- Clean grayscale gradient: dark → medium → white

function render(ctx, state, data)
    local w, h = ctx:size()
    local center_y = h / 2
    local max_h = h * 0.8

    if state == "idle" then
        ctx:set_color({96, 96, 96})
        ctx:draw_line(10, center_y, w - 10, center_y, 2)

    elseif state == "recording" then
        -- Waveform bars with brightness gradient per segment
        local bar_count = 32
        local bar_width = w / bar_count * 0.8
        local spacing = w / bar_count

        for i = 1, bar_count do
            local level = data.levels[i] or 0
            local amp = math.min(1, math.sqrt(level * 8))
            local bar_h = math.max(2, amp * max_h)

            local x = (i - 0.5) * spacing
            local seg_h = 2
            local segments = math.ceil(bar_h / seg_h)

            for seg = 0, segments - 1 do
                local y = center_y - bar_h / 2 + seg * seg_h
                local t = (seg * seg_h) / max_h
                local brightness = 60 + math.floor(t * 195)
                ctx:set_color({brightness, brightness, brightness})
                ctx:draw_rect(x - bar_width / 2, y, bar_width, seg_h)
            end
        end

    elseif state == "transcribing" then
        -- Pendulum wave: 32 bars with brightness gradient per segment
        local bar_count = 32
        local bar_width = w / bar_count * 0.8
        local spacing = w / bar_count

        for i = 1, bar_count do
            local freq = 1.0 + (i - 1) * 0.03
            local swing = math.sin(data.time * freq * 2)
            local bar_h = math.max(2, (swing * 0.5 + 0.5) * max_h * 0.7)

            local x = (i - 0.5) * spacing
            local seg_h = 2
            local segments = math.ceil(bar_h / seg_h)

            for seg = 0, segments - 1 do
                local y = center_y - bar_h / 2 + seg * seg_h
                local t = (seg * seg_h) / max_h
                local brightness = 60 + math.floor(t * 195)
                ctx:set_color({brightness, brightness, brightness})
                ctx:draw_rect(x - bar_width / 2, y, bar_width, seg_h)
            end
        end
    end
end
